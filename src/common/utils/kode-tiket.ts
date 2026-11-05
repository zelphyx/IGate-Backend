import { randomInt } from 'crypto';

/** Alphabet tanpa karakter mudah tertukar (0/O, 1/I/L) untuk kode tampilan. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KODE_TIKET_PREFIX = 'IGATE-';
export const KODE_TIKET_LENGTH = 6;

/**
 * Kode unik tampilan per tiket (opsi 2): `IGATE-XXXXXX` — acak, bukan rahasia
 * (rahasia check-in tetap qrToken). Dipanggil dengan retry unique-violation di pemanggil.
 */
export function generateKodeTiket(): string {
  let code = '';
  for (let i = 0; i < KODE_TIKET_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${KODE_TIKET_PREFIX}${code}`;
}
