/** Masking PII untuk log & Discord (PRD §12.6). */

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

/**
 * NIM tidak dimask untuk log Discord: panitia butuh NIM utuh untuk
 * cross-check peserta saat check-in/manual fulfillment (keputusan panitia).
 * NIM bukan rahasia sekelas password — hanya jangan tampilkan PII lain utuh.
 */
export function maskNim(nim: string): string {
  return nim;
}
