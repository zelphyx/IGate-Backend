import { fromCents, isZeroMoney, minMoney, subMoney, toCents, addFeePercent } from './money';

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

  it('addFeePercent: nominal tagihan = ceil(value/(1−fee)), rupiah penuh (fee 0,7% = 7)', () => {
    // 45000/0,993 = 45317,22 → 45318
    expect(addFeePercent('45000', 7)).toBe('45318.00');
    // 5000/0,993 = 5035,25 → 5036
    expect(addFeePercent('5000', 7)).toBe('5036.00');
    // 100000/0,993 = 100704,93 → 100705
    expect(addFeePercent('100000', 7)).toBe('100705.00');
    // fee 0 → apa adanya
    expect(addFeePercent('45000', 0)).toBe('45000.00');
    // hasil sudah rupiah penuh → tidak dibulatkan lagi
    expect(addFeePercent('99300', 7)).toBe('100000.00'); // 99300/0,993 = 100000 pas
    // fee 0,8% = 8 permil: 45000/0,992 = 45362,90 → 45363
    expect(addFeePercent('45000', 8)).toBe('45363.00');
    expect(addFeePercent('5000', 8)).toBe('5041.00'); // 5000/0,992 = 5040,32 → 5041
  });
});
