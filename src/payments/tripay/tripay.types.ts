export interface CreateTripayInput {
  merchantRef: string;
  amount: number;
  expiredMinutes: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Kode channel Tripay, default dari config TRIPAY_CHANNELS[0] */
  method?: string;
  orderItemName: string;
}

/** Kontrak klien Tripay — live (sandbox/production) & stub memakai interface sama. */
export interface TripayClient {
  createTransaction(input: CreateTripayInput): Promise<TripayTransaction>;
  closeTransaction(reference: string): Promise<void>;
  getTransactionDetail(reference: string): Promise<TripayDetail>;
  createSignature(merchantRef: string, amount: number): string;
  verifyCallbackSignature(rawBody: Buffer | string, signature: string | undefined): boolean;
}

export interface TripayTransaction {
  reference: string;
  merchantRef: string;
  checkoutUrl: string;
  payCode?: string;
  qrUrl?: string;
  amount: number;
  expiredAt: Date;
}

export interface TripayDetail {
  reference: string;
  merchantRef: string;
  status: string;
  paymentMethod?: string;
  amount: number;
  checkoutUrl?: string;
}

export interface TripayCallbackPayload {
  reference: string;
  merchant_ref: string;
  status: string;
  payment_method?: string;
  amount?: number;
  paid_at?: number;
}

export class TripayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TripayError';
  }
}
