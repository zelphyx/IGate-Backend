import { randomInt } from 'crypto';

/** Charset kode voucher tanpa 0/O dan 1/I (menghindari salah baca). */
const VOUCHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const VOUCHER_CODE_REGEX = /^IGATE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Kode voucher format `IGATE-XXXX-XXXX` (PLAN §T7). */
export function generateVoucherCode(): string {
  const block = (n: number) =>
    Array.from({ length: n }, () => VOUCHER_ALPHABET[randomInt(VOUCHER_ALPHABET.length)]).join('');
  return `IGATE-${block(4)}-${block(4)}`;
}
