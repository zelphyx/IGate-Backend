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
  closeTransaction(reference: string): Promise<void>;
  getTransactionDetail(reference: string): Promise<BelibayarDetail>;
  verifyCallbackSignature(
    rawBody: Buffer | string,
    signature?: string,
  ): boolean;
}

export interface BelibayarTransaction {
  reference: string;
  merchantRef: string;
  checkoutUrl: string;
  payCode?: string;
  qrUrl?: string;
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
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BelibayarError';
  }
}

