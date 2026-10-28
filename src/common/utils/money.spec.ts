import { fromCents, isZeroMoney, minMoney, subMoney, toCents } from './money';

describe('money utils (BR-13: tanpa float)', () => {
  it('toCents/fromCents bolak-balik', () => {
    expect(toCents('100000')).toBe(10000000n);
    expect(toCents('123.45')).toBe(12345n);
    expect(toCents('0.05')).toBe(5n);
    expect(fromCents(10000000n)).toBe('100000.00');
    expect(fromCents(5n)).toBe('0.05');
  });

  it('format tidak valid → throw', () => {
    expect(() => toCents('1,000')).toThrow();
    expect(() => toCents('abc')).toThrow();
    expect(() => toCents('1.234')).toThrow();
  });

  it('minMoney & subMoney', () => {
    expect(minMoney('50000', '100000')).toBe('50000.00');
    expect(minMoney('150000', '100000')).toBe('100000.00');
    expect(subMoney('100000', '50000')).toBe('50000.00');
    expect(subMoney('100000', '100000')).toBe('0.00');
  });

  it('isZeroMoney', () => {
    expect(isZeroMoney('0')).toBe(true);
    expect(isZeroMoney('0.00')).toBe(true);
    expect(isZeroMoney('1')).toBe(false);
  });
});
