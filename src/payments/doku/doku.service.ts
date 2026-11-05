import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  CreateDokuInput,
  DokuCallbackHeaders,
  DokuCallbackPayload,
  DokuClient,
  DokuDetail,
  DokuError,
  DokuTransaction,
} from './doku.types';

const TIMEOUT_MS = 15_000;

/**
 * Klien DOKU Checkout (non-SNAP) — docs.doku.com.
 * - Buat invoice : POST {base}/checkout/v1/payment
 * - Check status : GET  {base}/orders/v1/status/{invoice_number}
 * - Signature    : HMAC-SHA256 base64 atas komponen
 *                  Client-Id\nRequest-Id\nRequest-Timestamp\nRequest-Target[\nDigest]
 * - Notifikasi   : verifikasi Signature header atas raw body + Request-Target
 *                  (path Notification URL yang terdaftar di dashboard DOKU).
 */
@Injectable()
export class DokuLiveService implements DokuClient {
  private readonly logger = new Logger(DokuLiveService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    const mode = config.get<string>('doku.mode');
    this.baseUrl =
      mode === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
  }

  /** SHA-256 body → base64 (komponen Digest, hanya untuk request ber-body). */
  generateDigest(jsonBody: string): string {
    return createHash('sha256').update(jsonBody, 'utf-8').digest('base64');
  }

  /** HMAC-SHA256 base64 atas komponen signature + prefix `HMACSHA256=`. */
  generateSignature(
    clientId: string,
    requestId: string,
    requestTimestamp: string,
    requestTarget: string,
    digest: string,
    secret: string,
  ): string {
    let component = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${requestTarget}`;
    if (digest) component += `\nDigest:${digest}`;
    const hmac = createHmac('sha256', secret).update(component).digest('base64');
    return `HMACSHA256=${hmac}`;
  }

  verifyCallbackSignature(
    rawBody: Buffer | string,
    headers: DokuCallbackHeaders,
    requestTarget: string,
  ): boolean {
    const { clientId, requestId, requestTimestamp, signature } = headers;
    if (!clientId || !requestId || !requestTimestamp || !signature) return false;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const digest = this.generateDigest(body);
    const expected = this.generateSignature(
      clientId,
      requestId,
      requestTimestamp,
      requestTarget,
      digest,
      this.config.getOrThrow<string>('doku.secretKey'),
    );
    return this.safeEqual(expected, signature);
  }

  async createTransaction(input: CreateDokuInput): Promise<DokuTransaction> {
    const channels = this.config.get<string[]>('doku.channels') ?? ['VIRTUAL_ACCOUNT_BCA'];
    const method = input.method ?? channels[0];
    const callbackUrl = this.config.getOrThrow<string>('returnUrl');
    const body = {
      order: {
        amount: input.amount,
        invoice_number: input.merchantRef,
        callback_url: callbackUrl,
        line_items: [{ name: input.orderItemName, price: input.amount, quantity: 1 }],
      },
      payment: { payment_due_date: input.expiredMinutes, payment_method_types: [method] },
      customer: {
        name: input.customerName,
        email: input.customerEmail,
        phone: input.customerPhone,
      },
    };
    const data = await this.request<Record<string, unknown>>(
      '/checkout/v1/payment',
      { method: 'POST', body: JSON.stringify(body) },
    );
    const response = (data['response'] ?? {}) as Record<string, unknown>;
    const order = (response['order'] ?? {}) as Record<string, unknown>;
    const payment = (response['payment'] ?? {}) as Record<string, unknown>;
    const expiredRaw = String(payment['expired_date'] ?? '');
    // expired_date DOKU: YYYYMMDDHHmmss (WIB) — hanya dipakai fallback; sweep memakai timer lokal.
    const expiredAt = expiredRaw.match(/^\d{14}$/)
      ? new Date(
          Date.UTC(
            +expiredRaw.slice(0, 4),
            +expiredRaw.slice(4, 6) - 1,
            +expiredRaw.slice(6, 8),
            +expiredRaw.slice(8, 10) - 7,
            +expiredRaw.slice(10, 12),
            +expiredRaw.slice(12, 14),
          ),
        )
      : new Date(Date.now() + input.expiredMinutes * 60_000);
    return {
      reference: String(order['invoice_number'] ?? input.merchantRef),
      merchantRef: input.merchantRef,
      checkoutUrl: String(payment['url'] ?? ''),
      amount: Number(order['amount'] ?? input.amount),
      expiredAt,
    };
  }

  /** DOKU Checkout tidak punya close/cancel API non-SNAP — noop; expired ditangani payment_due_date. */
  async closeTransaction(reference: string): Promise<void> {
    void reference;
  }

  async getTransactionDetail(reference: string): Promise<DokuDetail> {
    const data = await this.request<Record<string, unknown>>(
      `/orders/v1/status/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    const response = (data['response'] ?? data) as Record<string, unknown>;
    const transaction = (response['transaction'] ?? {}) as Record<string, unknown>;
    const order = (response['order'] ?? {}) as Record<string, unknown>;
    const channel = (response['channel'] ?? {}) as Record<string, unknown>;
    return {
      reference: String(order['invoice_number'] ?? reference),
      merchantRef: String(order['invoice_number'] ?? ''),
      status: String(transaction['status'] ?? 'PENDING'),
      paymentMethod: channel['id'] ? String(channel['id']) : undefined,
      amount: Number(order['amount'] ?? 0),
    };
  }

  private async request<T>(path: string, init: RequestInit, retry = 1): Promise<T> {
    const clientId = this.config.getOrThrow<string>('doku.clientId');
    const secretKey = this.config.getOrThrow<string>('doku.secretKey');
    const requestId = randomUUID();
    const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const bodyStr = typeof init.body === 'string' ? init.body : '';
    const digest = bodyStr ? this.generateDigest(bodyStr) : '';
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Client-Id': clientId,
          'Request-Id': requestId,
          'Request-Timestamp': requestTimestamp,
          Signature: this.generateSignature(
            clientId,
            requestId,
            requestTimestamp,
            path,
            digest,
            secretKey,
          ),
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string[] | string;
        response?: T;
      };
      if (!res.ok) {
        const msg = Array.isArray(json.message) ? json.message.join('; ') : json.message;
        throw new DokuError(msg ?? `HTTP ${res.status}`, res.status);
      }
      return (json.response ?? (json as unknown as T)) as T;
    } catch (err) {
      // 1x retry untuk error jaringan/timeout (FR-3.1)
      if (retry > 0 && !(err instanceof DokuError)) {
        this.logger.warn(`DOKU request gagal (${(err as Error).message}), retry...`);
        return this.request<T>(path, init, retry - 1);
      }
      if (err instanceof DokuError) throw err;
      throw new DokuError((err as Error).message);
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}

/** DOKU_MODE=test — respons fixture, tanpa internet (dev & e2e). */
@Injectable()
export class DokuStubService implements DokuClient {
  verifyCallbackSignature(
    rawBody: Buffer | string,
    headers: DokuCallbackHeaders,
    _requestTarget?: string,
  ): boolean {
    if (!headers.signature) return false;
    return headers.signature === `valid-${String(rawBody).length}`;
  }

  async createTransaction(input: CreateDokuInput): Promise<DokuTransaction> {
    return {
      reference: input.merchantRef,
      merchantRef: input.merchantRef,
      checkoutUrl: `https://doku.test/checkout/${input.merchantRef}`,
      payCode: `PAYCODE-${input.merchantRef}`,
      amount: input.amount,
      expiredAt: new Date(Date.now() + input.expiredMinutes * 60_000),
    };
  }

  async closeTransaction(reference: string): Promise<void> {
    void reference;
  }

  async getTransactionDetail(reference: string): Promise<DokuDetail> {
    return {
      reference,
      merchantRef: reference,
      status: 'PENDING',
      paymentMethod: 'VIRTUAL_ACCOUNT_BCA',
      amount: 0,
    };
  }
}

/** Status DOKU → status internal tiket/voucher (TICKET_PAYMENT_STATUS). */
function mapDokuStatus(dokuStatus: string): string {
  switch (dokuStatus.toUpperCase()) {
    case 'SUCCESS':
      return 'PAID';
    case 'FAILED':
    case 'EXPIRED':
    case 'VOIDED':
      return dokuStatus.toUpperCase();
    default:
      return dokuStatus;
  }
}

/** Ekspor helper untuk konsumsi payload callback di PaymentsService. */
export function parseCallbackJson(raw: Buffer | string): DokuCallbackPayload {
  const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
  const order = (parsed['order'] ?? {}) as Record<string, unknown>;
  const transaction = (parsed['transaction'] ?? {}) as Record<string, unknown>;
  const channel = (parsed['channel'] ?? {}) as Record<string, unknown>;
  const dokuStatus = String(transaction['status'] ?? 'PENDING');
  return {
    reference: String(transaction['original_request_id'] ?? ''),
    merchant_ref: String(order['invoice_number'] ?? ''),
    status: mapDokuStatus(dokuStatus),
    payment_method: channel['id'] ? String(channel['id']) : undefined,
    amount: order['amount'] !== undefined ? Number(order['amount']) : undefined,
    paid_at: transaction['date'] ? String(transaction['date']) : undefined,
  };
}
