export interface CreateBelibayarInput {
  merchantRef: string;
  amount: number;
  expiredMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  method?: string;
  orderItemName: string;
}

export interface BelibayarCallbackHeaders {
  signature?: string;
}

export interface BelibayarClient {
  createTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction>;
  /** QRIS dinamis (payment/charge) — mengembalikan qrContent EMV untuk digambar frontend. */
  createQrisTransaction(input: CreateBelibayarInput): Promise<BelibayarTransaction>;
  closeTransaction(reference: string): Promise<void>;
  /** Batalkan transaksi charge yang masih pending (jalur QRIS/VA). */
  cancelChargeTransaction(reference: string): Promise<void>;
  getTransactionDetail(reference: string): Promise<BelibayarDetail>;
  /** Cek status transaksi charge (GET /payment/status/{reference}). */
  getChargeTransactionDetail(reference: string): Promise<BelibayarDetail>;
  verifyCallbackSignature(
    rawBody: Buffer | string,
    signature?: string,
  ): boolean;
}

export interface BelibayarTransaction {
  reference: string;
  merchantRef: string;
  /** URL halaman pembayaran (payment link). Kosong untuk transaksi QRIS charge. */
  checkoutUrl: string;
  /** String EMV QRIS dinamis — hanya untuk transaksi QRIS (payment/charge). */
  qrContent?: string;
  /** URL PNG QRIS dari provider — hanya untuk transaksi QRIS. */
  qrUrl?: string;
  payCode?: string;
  amount: number;
  expiredAt: Date;
}

export interface BelibayarDetail {
  reference: string;
  merchantRef: string;
  status: string;
  paymentMethod?: string;
  amount: number;
  checkoutUrl?: string;
  qrContent?: string;
  qrUrl?: string;
}

export interface BelibayarCallbackPayload {
  reference: string;
  merchant_ref: string;
  status: string;
  payment_method?: string;
  amount?: number;
  paid_at?: string;
}

export class BelibayarError extends Error {
  constructor(
    message: string,
    /** Status HTTP dari Belibayar; kosong untuk kegagalan jaringan (belum ada jawaban). */
    public readonly status?: number,
    /** Kode jaringan (ECONNRESET, EAI_AGAIN, TIMEOUT, ...) bila gagal sebelum ada jawaban. */
    public readonly code?: string,
    /** Cuplikan isi jawaban error Belibayar (dipotong) — hanya untuk log server, bukan alert. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'BelibayarError';
  }

  /** Ringkasan satu baris tanpa data sensitif: asal kegagalan + pesan. */
  describe(): string {
    const where = this.status ? `HTTP ${this.status}` : this.code ? `jaringan ${this.code}` : 'error';
    return `${where}: ${this.message}`.slice(0, 240);
  }
}

/**
 * Ringkasan kegagalan Belibayar untuk log/alert. `withDetail` menambahkan cuplikan jawaban
 * Belibayar — pakai hanya untuk log server, jangan untuk kanal chat.
 */
export function describeBelibayarError(err: unknown, withDetail = false): string {
  if (err instanceof BelibayarError) {
    return withDetail && err.detail ? `${err.describe()} | ${err.detail}` : err.describe();
  }
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 240) : String(err).slice(0, 240);
}

