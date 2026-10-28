import { generateVoucherCode, VOUCHER_CODE_REGEX } from './voucher-code';

describe('voucher-code', () => {
  it('format IGATE-XXXX-XXXX tanpa 0/O/1/I', () => {
    for (let i = 0; i < 50; i++) {
      const kode = generateVoucherCode();
      expect(kode).toMatch(VOUCHER_CODE_REGEX);
    }
  });

  it('unik secara statistik (100 kode → ≥95 unik)', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateVoucherCode()));
    expect(codes.size).toBeGreaterThanOrEqual(95);
  });
});
