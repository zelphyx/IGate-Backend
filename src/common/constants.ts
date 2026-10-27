/**
 * Nilai status & konstanta domain.
 * Kolom di DB varchar sesuai ERD — validasi nilai lewat konstanta ini (PRD Global Constraints).
 */

export const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  SCANNER: 'scanner',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const TICKET_PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const;

export const TICKET_STATUS = {
  PENDING: 'PENDING',
  ISSUED: 'ISSUED',
  CHECKED_IN: 'CHECKED_IN',
} as const;

export const VOUCHER_STATUS = {
  PENDING: 'PENDING',
  AKTIF: 'AKTIF',
  TERPAKAI: 'TERPAKAI',
  EXPIRED: 'EXPIRED',
  NONAKTIF: 'NONAKTIF',
} as const;

export const TRANSACTION_TYPES = {
  PEMBELIAN_TIKET: 'PEMBELIAN_TIKET',
  PEMBELIAN_VOUCHER: 'PEMBELIAN_VOUCHER',
} as const;

export const PAYMENT_METHODS = {
  MANUAL: 'MANUAL',
  VOUCHER: 'VOUCHER',
} as const;

export const REKAP_STATUS = {
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
} as const;

/** Prefix merchant_ref Tripay */
export const MERCHANT_REF_PREFIX = {
  TIKET: 'TKT-',
  VOUCHER: 'VCH-',
} as const;

export const MERCHANT_REF_REGEX = /^(TKT|VCH)-(\d+)$/;
