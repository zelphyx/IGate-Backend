import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  BelibayarCallbackPayload,
  BelibayarClient,
  BelibayarDetail,
  BelibayarError,
  BelibayarTransaction,
  CreateBelibayarInput,
} from './belibayar.types';

const TIMEOUT_MS = 15_000;
/** Total percobaan (1 awal + 2 ulang) dan batas waktu total untuk mengulang. */
const MAX_ATTEMPTS = 3;
const RETRY_BUDGET_MS = 20_000;
const VALID_EXPIRY_MINUTES = [30, 60, 120, 360, 480, 720, 1440];

/** Normalisasi durasi kadaluwarsa ke salah satu nilai yang didukung Belibayar. */
export function normalizeExpiryMinutes(minutes: number): number {
  if (VALID_EXPIRY_MINUTES.includes(minutes)) return minutes;
  return VALID_EXPIRY_MINUTES.reduce((prev, curr) =>
    Math.abs(curr - minutes) < Math.abs(prev - minutes) ? curr : prev,
  );
}

/** Format nomor HP ke 628xxx sesuai format yang disarankan Belibayar. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

/**
 * Klien Belibayar (Direct API & Payment Link) — docs.belibayar.id.
 * - QRIS dinamis      : POST {base}/direct/v1[/sandbox]/payment/charge   → data.qr_content (EMV)
 * - Status charge     : GET  {base}/direct/v1[/sandbox]/payment/status/{reference}
 *                       (signature legacy: canonical = ":" + timestamp, header X-Timestamp)
 * - Batalkan charge   : POST {base}/direct/v1[/sandbox]/payment/cancel
 * - Buat payment link : POST {base}/direct/v1[/sandbox]/payment-link
 * - Cek status link   : POST {base}/direct/v1[/sandbox]/payment-link/status
 * - Batalkan link     : POST {base}/direct/v1[/sandbox]/payment-link/cancel
 * - Signature         : hex(HMAC-SHA256(canonical, secret_key))
 *                      POST: canonical = raw JSON body
 *                      GET : canonical = path (mis. /direct/v1/channels)
 * - Webhook          : verifikasi header X-Belibayar-Signature atas raw body dengan webhook_secret
 */
@Injectable()
export class BelibayarLiveService implements BelibayarClient {
  private readonly logger = new Logger(BelibayarLiveService.name);
  private readonly baseUrl = 'https://api.belibayar.id';
  private readonly pathPrefix: string;

  constructor(private readonly config: ConfigService) {
    const mode = this.config.get<string>('belibayar.mode');
    const apiKey = this.config.get<string>('belibayar.apiKey') ?? '';
    const isLive = mode === 'production' || mode === 'live' || apiKey.startsWith('byr_live_');
    this.pathPrefix = isLive ? '/direct/v1' : '/direct/v1/sandbox';
  }

  /** HMAC-SHA256 hex atas canonical string. */
  generateSignature(canonical: string, secret: string): string {
    return createHmac('sha256', secret).update(canonical, 'utf-8').digest('hex');
  }

  verifyCallbackSignature(rawBody: Buffer | string, signature?: string): boolean {
    if (!signature) return false;
    const webhookSecret = this.config.getOrThrow<string>('belibayar.webhookSecret');
    const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf-8');
    const expected = createHmac('sha256', webhookSecret).update(bodyBuf).digest('hex');
    return this.safeEqual(expected, signature.trim());
  }

  async createTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction> {
    const returnUrl = this.config.get<string>('returnUrl');
    const channels = this.config.get<string[]>('belibayar.channels') ?? [];

    const bodyObj: Record<string, unknown> = {
      reference: input.merchantRef,
      amount: input.amount,
      description: input.orderItemName,
      expiry_minutes: normalizeExpiryMinutes(input.expiredMinutes),
      customer_input_by: 'merchant',
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      customer_phone: normalizePhone(input.customerPhone),
    };

    if (returnUrl) {
      bodyObj.success_url = returnUrl;
      bodyObj.failure_url = returnUrl;
    }

    if (input.method) {
      bodyObj.channels_allowed = [input.method.toLowerCase()];
    } else if (channels.length > 0) {
      bodyObj.channels_allowed = channels.map((c) => c.toLowerCase());
    }

    const jsonBody = JSON.stringify(bodyObj);
    const data = await this.request<Record<string, unknown>>(
      `${this.pathPrefix}/payment-link`,
      { method: 'POST', body: jsonBody },
    );

    const linkData = (data['data'] ?? data) as Record<string, unknown>;
    const expiresAtSec = Number(linkData['expires_at'] ?? 0);
    const expiredAt = expiresAtSec > 0
      ? new Date(expiresAtSec * 1000)
      : new Date(Date.now() + input.expiredMinutes * 60_000);

    return {
      reference: String(linkData['code'] ?? linkData['reference'] ?? input.merchantRef),
      merchantRef: input.merchantRef,
      checkoutUrl: String(linkData['payment_link_url'] ?? ''),
      amount: Number(linkData['amount'] ?? input.amount),
      expiredAt,
    };
  }

  /**
   * QRIS dinamis via POST /payment/charge — respons data.qr_content adalah string EMV
   * yang digambar frontend jadi QRIS asli (nominal terkunci, sekali pakai).
   */
  async createQrisTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction> {
    const bodyObj: Record<string, unknown> = {
      reference: input.merchantRef,
      amount: input.amount,
      pay_method: { method: 'qris' },
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      static_qr: false,
      // payment/charge pakai expired_time unix detik (min 60s, maks 90 hari)
      expired_time: Math.floor(Date.now() / 1000) + input.expiredMinutes * 60,
    };
    if (input.customerPhone) {
      bodyObj['customer_phone'] = normalizePhone(input.customerPhone);
    }

    const jsonBody = JSON.stringify(bodyObj);
    const data = await this.request<Record<string, unknown>>(
      `${this.pathPrefix}/payment/charge`,
      { method: 'POST', body: jsonBody },
    );

    const d = (data['data'] ?? {}) as Record<string, unknown>;
    const expiredAtSec = Number(d['expired_at'] ?? 0);
    const expiredAt =
      expiredAtSec > 0
        ? new Date(expiredAtSec * 1000)
        : new Date(Date.now() + input.expiredMinutes * 60_000);

    return {
      reference: String(d['reference'] ?? input.merchantRef),
      merchantRef: input.merchantRef,
      checkoutUrl: '',
      qrContent: d['qr_content'] ? String(d['qr_content']) : undefined,
      qrUrl: d['qr_url'] ? String(d['qr_url']) : undefined,
      amount: Number(d['amount'] ?? input.amount),
      expiredAt,
    };
  }

  /** Batalkan transaksi charge (VA/eWallet/QRIS/Retail) yang masih pending. */
  async cancelChargeTransaction(reference: string): Promise<void> {
    const bodyObj = { reference, reason: 'Pesanan kedaluwarsa / dibatalkan' };
    try {
      await this.request(
        `${this.pathPrefix}/payment/cancel`,
        { method: 'POST', body: JSON.stringify(bodyObj) },
      );
    } catch (err) {
      if (err instanceof BelibayarError && err.status === 409) {
        // sudah paid / expired / cancelled — noop
        return;
      }
      throw err;
    }
  }

  /** Cek status transaksi charge (GET /payment/status/{reference}, signature X-Timestamp). */
  async getChargeTransactionDetail(reference: string): Promise<BelibayarDetail> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secretKey = this.config.getOrThrow<string>('belibayar.secretKey');
    // GET tanpa body → canonical = ":" + timestamp (signature legacy v1 + X-Timestamp)
    const signature = createHmac('sha256', secretKey).update(`:${timestamp}`, 'utf-8').digest('hex');

    const data = await this.request<Record<string, unknown>>(
      `${this.pathPrefix}/payment/status/${encodeURIComponent(reference)}`,
      { method: 'GET', headers: { 'X-Timestamp': timestamp, 'X-Signature': signature } },
    );

    const d = (data['data'] ?? {}) as Record<string, unknown>;
    return {
      reference: String(d['reference'] ?? reference),
      merchantRef: String(d['reference'] ?? reference),
      status: mapBelibayarStatus(String(d['status'] ?? 'pending')),
      paymentMethod: d['payment_channel'] ? String(d['payment_channel']) : undefined,
      amount: Number(d['amount'] ?? 0),
      qrContent: d['qr_content'] ? String(d['qr_content']) : undefined,
      qrUrl: d['qr_url'] ? String(d['qr_url']) : undefined,
    };
  }

  /**
   * Batalkan payment link yang belum dibayar saat pesanan expired / dibatalkan.
   * Toleran terhadap HTTP 409 (NOT_CANCELLABLE jika link sudah paid/expired).
   */
  async closeTransaction(reference: string): Promise<void> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(reference);
    const bodyObj = isUuid
      ? { link_id: reference, reason: 'Pesanan kedaluwarsa / dibatalkan' }
      : { reference_id: reference, reason: 'Pesanan kedaluwarsa / dibatalkan' };

    try {
      await this.request(
        `${this.pathPrefix}/payment-link/cancel`,
        { method: 'POST', body: JSON.stringify(bodyObj) },
      );
    } catch (err) {
      if (err instanceof BelibayarError && err.status === 409) {
        // Link sudah paid / expired / cancelled di Belibayar — noop
        return;
      }
      throw err;
    }
  }

  async getTransactionDetail(reference: string): Promise<BelibayarDetail> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(reference);
    const bodyObj = isUuid ? { link_id: reference } : { reference_id: reference };

    const data = await this.request<Record<string, unknown>>(
      `${this.pathPrefix}/payment-link/status`,
      { method: 'POST', body: JSON.stringify(bodyObj) },
    );

    const payload = (data['data'] ?? data) as Record<string, unknown>;
    const trx = (payload['transaction'] ?? {}) as Record<string, unknown>;

    const statusRaw = String(trx['status'] ?? payload['status'] ?? 'PENDING');
    const status = mapBelibayarStatus(statusRaw);
    const paymentMethod = trx['payment_channel']
      ? String(trx['payment_channel'])
      : trx['payment_method']
        ? String(trx['payment_method'])
        : undefined;

    return {
      reference: String(payload['link_id'] ?? payload['reference_id'] ?? reference),
      merchantRef: String(payload['reference_id'] ?? reference),
      status,
      paymentMethod,
      amount: Number(trx['amount'] ?? payload['amount'] ?? 0),
      checkoutUrl: payload['payment_link_url'] ? String(payload['payment_link_url']) : undefined,
    };
  }

  /** Jeda sebelum percobaan ulang `attempt` (1, 2, ...): 400/800 ms + sedikit acak. Dipisah agar bisa diuji. */
  protected retryDelayMs(attempt: number): number {
    return 400 * attempt + Math.floor(Math.random() * 200);
  }

  /**
   * Kegagalan yang aman diulang:
   * - jaringan (belum ada jawaban dari Belibayar) — transaksi belum terbentuk;
   * - 429 — ditolak sebelum diproses;
   * - 502/503/504 hanya untuk GET (baca saja). Untuk POST, jawaban 5xx bisa berarti transaksi
   *   sudah terbentuk, jadi tidak diulang agar tidak membuat tagihan ganda.
   */
  private isRetryable(err: BelibayarError, init: RequestInit): boolean {
    if (err.status === undefined) return true;
    if (err.status === 429) return true;
    const isGet = (init.method ?? 'GET').toUpperCase() === 'GET';
    return isGet && [502, 503, 504].includes(err.status);
  }

  /** Bungkus error `fetch` (undici) jadi BelibayarError dengan kode penyebab (ECONNRESET, EAI_AGAIN, ...). */
  private toNetworkError(err: unknown): BelibayarError {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e?.name === 'TimeoutError' ? 'TIMEOUT' : e?.cause?.code;
    const base = e?.message ?? 'fetch failed';
    return new BelibayarError(code ? `${base} (${code})` : base, undefined, code);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const apiKey = this.config.getOrThrow<string>('belibayar.apiKey');
    const secretKey = this.config.getOrThrow<string>('belibayar.secretKey');

    const bodyStr = typeof init.body === 'string' ? init.body : '';
    // Untuk POST ber-body: canonical = raw body. Untuk GET tanpa body: canonical = path.
    const canonical = bodyStr || path;
    const signature = this.generateSignature(canonical, secretKey);

    const startedAt = Date.now();
    for (let attempt = 1; ; attempt++) {
      let failure: BelibayarError;
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            'X-Api-Key': apiKey,
            'X-Signature': signature,
            ...(bodyStr ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers ?? {}),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        let parsed = true;
        const json = (await res.json().catch(() => {
          parsed = false;
          return {};
        })) as {
          success?: boolean;
          messages?: string[] | string;
          data?: unknown;
        };

        if (res.ok) return json as T;

        const msg = Array.isArray(json.messages)
          ? json.messages.join('; ')
          : json.messages ?? `HTTP ${res.status}`;
        const detail = parsed ? JSON.stringify(json).slice(0, 300) : 'jawaban bukan JSON';
        failure = new BelibayarError(msg, res.status, undefined, detail);
      } catch (err) {
        failure = this.toNetworkError(err);
      }

      // Batas total supaya pembeli tidak menunggu terlalu lama (timeout per percobaan 15 dtk).
      const withinBudget = Date.now() - startedAt < RETRY_BUDGET_MS;
      if (attempt < MAX_ATTEMPTS && withinBudget && this.isRetryable(failure, init)) {
        const wait = this.retryDelayMs(attempt);
        this.logger.warn(
          `Belibayar ${init.method ?? 'GET'} ${path} gagal (${failure.describe()}), percobaan ${attempt}/${MAX_ATTEMPTS}, ulang ${wait} ms lagi`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw failure;
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}

/** BELIBAYAR_MODE=test — respons fixture tanpa internet (dev & e2e). */
@Injectable()
export class BelibayarStubService implements BelibayarClient {
  verifyCallbackSignature(rawBody: Buffer | string, signature?: string): boolean {
    if (!signature) return false;
    const len = Buffer.isBuffer(rawBody) ? rawBody.length : Buffer.byteLength(String(rawBody));
    return (
      signature === `valid-${len}` ||
      signature === `valid-${String(rawBody).length}` ||
      signature === 'valid-x'
    );
  }

  async createTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction> {
    return {
      reference: input.merchantRef,
      merchantRef: input.merchantRef,
      checkoutUrl: `https://link.belibayar.id/mock-${input.merchantRef}`,
      payCode: `PAYCODE-${input.merchantRef}`,
      amount: input.amount,
      expiredAt: new Date(Date.now() + input.expiredMinutes * 60_000),
    };
  }

  async createQrisTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction> {
    return {
      reference: input.merchantRef,
      merchantRef: input.merchantRef,
      checkoutUrl: '',
      // EMV palsu namun valid bentuknya — cukup untuk render QR di dev/e2e.
      qrContent: `00020101021226610014COM.BELIBAYARWBB0000000000000${input.merchantRef}`,
      qrUrl: `https://link.belibayar.id/v1/qris/mock-${input.merchantRef}.png`,
      amount: input.amount,
      expiredAt: new Date(Date.now() + input.expiredMinutes * 60_000),
    };
  }

  async closeTransaction(reference: string): Promise<void> {
    void reference;
  }

  async cancelChargeTransaction(reference: string): Promise<void> {
    void reference;
  }

  async getTransactionDetail(reference: string): Promise<BelibayarDetail> {
    return {
      reference,
      merchantRef: reference,
      status: 'PENDING',
      paymentMethod: 'VIRTUAL_ACCOUNT_BCA',
      amount: 0,
    };
  }

  async getChargeTransactionDetail(reference: string): Promise<BelibayarDetail> {
    return {
      reference,
      merchantRef: reference,
      status: 'PENDING',
      paymentMethod: 'QRIS',
      amount: 0,
    };
  }
}

/** Status Belibayar → status internal tiket/voucher (TICKET_PAYMENT_STATUS). */
export function mapBelibayarStatus(status: string): string {
  switch (status.toLowerCase()) {
    case 'paid':
    case 'success':
      return 'PAID';
    case 'expired':
      return 'EXPIRED';
    case 'cancelled':
    case 'canceled':
    case 'failed':
      return 'FAILED';
    default:
      return status.toUpperCase();
  }
}

/** Ekspor helper untuk parsing dan normalisasi payload webhook Belibayar. */
export function parseCallbackJson(raw: Buffer | string): BelibayarCallbackPayload {
  const parsed = JSON.parse(String(raw)) as Record<string, unknown>;

  // Dukungan fallback format DOKU (untuk pengujian atau legacy stub)
  if (parsed['order'] || parsed['transaction']) {
    const order = (parsed['order'] ?? {}) as Record<string, unknown>;
    const transaction = (parsed['transaction'] ?? {}) as Record<string, unknown>;
    const channel = (parsed['channel'] ?? {}) as Record<string, unknown>;
    const rawStatus = String(transaction['status'] ?? 'PENDING');
    return {
      reference: String(transaction['original_request_id'] ?? ''),
      merchant_ref: String(order['invoice_number'] ?? ''),
      status: mapBelibayarStatus(rawStatus),
      payment_method: channel['id'] ? String(channel['id']) : undefined,
      amount: order['amount'] !== undefined ? Number(order['amount']) : undefined,
      paid_at: transaction['date'] ? String(transaction['date']) : undefined,
    };
  }

  // Format webhook Belibayar resmi (docs.belibayar.id/docs/webhooks)
  const status = mapBelibayarStatus(String(parsed['status'] ?? 'pending'));
  const paymentChannel = parsed['payment_channel'] ? String(parsed['payment_channel']) : undefined;
  const paymentMethod = parsed['payment_method'] ? String(parsed['payment_method']) : undefined;
  const methodCombined = paymentChannel ?? paymentMethod;

  return {
    reference: String(parsed['transaction_id'] ?? parsed['reference'] ?? ''),
    merchant_ref: String(parsed['reference'] ?? ''),
    status,
    payment_method: methodCombined,
    amount: parsed['amount'] !== undefined ? Number(parsed['amount']) : undefined,
    paid_at: parsed['paid_at'] ? String(parsed['paid_at']) : undefined,
  };
}

