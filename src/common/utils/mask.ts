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

export function maskNim(nim: string): string {
  if (nim.length <= 7) return '***';
  return `${nim.slice(0, 7)}***`;
}
