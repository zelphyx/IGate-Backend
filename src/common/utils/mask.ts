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

/** Nama untuk view publik: huruf pertama tiap kata utuh, sisanya bintang ("Budi S***"). */
export function maskNama(nama: string): string {
  return nama
    .split(/\s+/)
    .map((kata) =>
      kata.length <= 2 ? kata[0] + '*' : `${kata[0]}${'*'.repeat(kata.length - 2)}${kata[kata.length - 1]}`,
    )
    .join(' ');
}

/** NIM untuk view publik: 3 digit awal + mask sisanya ("240***********"). */
export function maskNimPublic(nim: string): string {
  if (nim.length <= 3) return '***';
  return `${nim.slice(0, 3)}${'*'.repeat(nim.length - 3)}`;
}
