import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CreateTripayInput,
  TripayCallbackPayload,
  TripayClient,
  TripayDetail,
  TripayError,
  TripayTransaction,
} from './tripay.types';

const TIMEOUT_MS = 15_000;

@Injectable()
export class TripayLiveService implements TripayClient {
  private readonly logger = new Logger(TripayLiveService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    const mode = config.get<string>('tripay.mode');
    this.baseUrl =
      mode === 'production' ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
  }

  createSignature(merchantRef: string, amount: number): string {
    const merchantCode = this.config.getOrThrow<string>('tripay.merchantCode');
    const privateKey = this.config.getOrThrow<string>('tripay.privateKey');
    return createHmac('sha256', privateKey).update(`${merchantCode}${merchantRef}${amount}`).digest('hex');
  }

  verifyCallbackSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    const privateKey = this.config.getOrThrow<string>('tripay.privateKey');
    const expected = createHmac('sha256', privateKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async createTransaction(input: CreateTripayInput): Promise<TripayTransaction> {
    const channels = this.config.get<string[]>('tripay.channels') ?? ['QRIS'];
    const method = input.method ?? channels[0];
    const returnUrl = this.config.getOrThrow<string>('appBaseUrl');
    const payload = {
      method,
      merchant_ref: input.merchantRef,
      amount: input.amount,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      order_items: [{ name: input.orderItemName, price: input.amount, quantity: 1 }],
      signature: this.createSignature(input.merchantRef, input.amount),
      expired_time: Math.floor(Date.now() / 1000) + input.expiredMinutes * 60,
      return_url: returnUrl,
    };
    const data = await this.request<Record<string, unknown>>('/merchant/transaction/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      reference: String(data['reference']),
      merchantRef: String(data['merchant_ref'] ?? input.merchantRef),
      checkoutUrl: String(data['checkout_url']),
      payCode: data['pay_code'] ? String(data['pay_code']) : undefined,
      qrUrl: data['qr_url'] ? String(data['qr_url']) : undefined,
      amount: Number(data['amount'] ?? input.amount),
      expiredAt: new Date(Number(data['expired_time'] ?? 0) * 1000),
    };
  }

  async closeTransaction(reference: string): Promise<void> {
    await this.request('/merchant/transaction/close', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    });
  }

  async getTransactionDetail(reference: string): Promise<TripayDetail> {
    const data = await this.request<Record<string, unknown>>(
      `/merchant/transaction/detail?reference=${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    return {
      reference: String(data['reference'] ?? reference),
      merchantRef: String(data['merchant_ref'] ?? ''),
      status: String(data['status'] ?? 'UNKNOWN'),
      paymentMethod: data['payment_method'] ? String(data['payment_method']) : undefined,
      amount: Number(data['amount'] ?? 0),
      checkoutUrl: data['checkout_url'] ? String(data['checkout_url']) : undefined,
    };
  }

  private async request<T>(path: string, init: RequestInit, retry = 1): Promise<T> {
    const apiKey = this.config.getOrThrow<string>('tripay.apiKey');
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        data?: T;
      };
      if (!res.ok || json.success === false) {
        throw new TripayError(json.message ?? `HTTP ${res.status}`, res.status);
      }
      return json.data as T;
    } catch (err) {
      // 1x retry untuk error jaringan/timeout (FR-3.1)
      if (retry > 0 && !(err instanceof TripayError)) {
        this.logger.warn(`Tripay request gagal (${(err as Error).message}), retry...`);
        return this.request<T>(path, init, retry - 1);
      }
      if (err instanceof TripayError) throw err;
      throw new TripayError((err as Error).message);
    }
  }
}

/** TRIPAY_MODE=test — respons fixture, tanpa internet (dev & e2e). */
@Injectable()
export class TripayStubService implements TripayClient {
  createSignature(merchantRef: string, amount: number): string {
    return `stub-signature-${merchantRef}-${amount}`;
  }

  verifyCallbackSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    return signature === `valid-${String(rawBody).length}`;
  }

  async createTransaction(input: CreateTripayInput): Promise<TripayTransaction> {
    return {
      reference: `TEST-${input.merchantRef}`,
      merchantRef: input.merchantRef,
      checkoutUrl: `https://tripay.test/checkout/${input.merchantRef}`,
      payCode: `PAYCODE-${input.merchantRef}`,
      qrUrl: `https://tripay.test/qr/${input.merchantRef}.png`,
      amount: input.amount,
      expiredAt: new Date(Date.now() + input.expiredMinutes * 60_000),
    };
  }

  async closeTransaction(reference: string): Promise<void> {
    void reference;
  }

  async getTransactionDetail(reference: string): Promise<TripayDetail> {
    return {
      reference,
      merchantRef: reference.replace(/^TEST-/, ''),
      status: 'UNPAID',
      paymentMethod: 'QRIS',
      amount: 0,
      checkoutUrl: `https://tripay.test/checkout/${reference.replace(/^TEST-/, '')}`,
    };
  }
}

/** Ekspor helper untuk konsumsi payload callback di PaymentsService. */
export function parseCallbackJson(raw: Buffer | string): TripayCallbackPayload {
  return JSON.parse(String(raw)) as TripayCallbackPayload;
}
