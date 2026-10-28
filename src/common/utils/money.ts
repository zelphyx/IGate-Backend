/**
 * Aritmetika nominal Decimal(12,2) sebagai string — dilarang pakai float (BR-13).
 * Format kanonik: "123.45" (selalu 2 desimal), sesuai yang Prisma terima/kirim.
 */

export function toCents(value: string | number): bigint {
  const s = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`Nominal tidak valid: ${value}`);
  }
  const neg = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  const cents = BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

export function minMoney(a: string, b: string): string {
  const ca = toCents(a);
  const cb = toCents(b);
  return fromCents(ca <= cb ? ca : cb);
}

export function subMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

export function isZeroMoney(a: string): boolean {
  return toCents(a) === 0n;
}
