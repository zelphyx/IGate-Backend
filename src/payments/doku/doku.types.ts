export interface CreateDokuInput {
  merchantRef: string;
  amount: number;
  expiredMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Kode payment_method_types DOKU (mis. VIRTUAL_ACCOUNT_BCA, QRIS). Default dari config DOKU_CHANNELS. */
  method?: string;
  orderItemName: string;
}

/** Header HTTP Notification DOKU yang dipakai untuk verifikasi signature. */
export interface DokuCallbackHeaders {
  clientId?: string;
  requestId?: string;
  requestTimestamp?: string;
  signature?: string;
}

/** Kontrak klien DOKU — live (sandbox/production) & stub memakai interface sama. */
export interface DokuClient {
  createTransaction(input: CreateDokuInput): Promise<DokuTransaction>;
  closeTransaction(reference: string): Promise<void>;
  getTransactionDetail(reference: string): Promise<DokuDetail>;
  verifyCallbackSignature(
    rawBody: Buffer | string,
    headers: DokuCallbackHeaders,
    requestTarget: string,
  ): boolean;
}

export interface DokuTransaction {
  /** invoice_number DOKU (= merchantRef TKT-{id} / VCH-{id}) — identifier Check Status. */
  reference: string;
  merchantRef: string;
  checkoutUrl: string;
  payCode?: string;
  qrUrl?: string;
  amount: number;
  expiredAt: Date;
}

export interface DokuDetail {
  reference: string;
  merchantRef: string;
  status: string;
  paymentMethod?: string;
  amount: number;
  checkoutUrl?: string;
}

/** Payload callback DOKU — dinormalisasi ke bentuk yang dikonsumsi PaymentsService. */
export interface DokuCallbackPayload {
  reference: string;
  merchant_ref: string;
  status: string;
  payment_method?: string;
  amount?: number;
  paid_at?: string;
}

export class DokuError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'DokuError';
  }
}
