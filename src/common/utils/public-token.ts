import { randomBytes } from 'crypto';

/**
 * Token publik acak 32-char (URL-safe) untuk endpoint status order — menggantikan
 * referensi TKT-{id} yang sekuensial di path publik (revisi keamanan 2026-11).
 * entropy 192-bit: brute force tidak layak; kegagalan collision ditangani retry di pemanggil.
 */
export const PUBLIC_TOKEN_LENGTH = 32;

export function generatePublicToken(): string {
  return randomBytes(24).toString('base64url').slice(0, PUBLIC_TOKEN_LENGTH);
}
