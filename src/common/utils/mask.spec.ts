import { maskEmail, maskNim, maskPhone } from './mask';

describe('mask utils (PRD §12.6)', () => {
  it('maskEmail: j***@gmail.com', () => {
    expect(maskEmail('john.doe@gmail.com')).toBe('j***@gmail.com');
  });

  it('maskEmail: tanpa @ → ***', () => {
    expect(maskEmail('bukan-email')).toBe('***');
  });

  it('maskPhone: 0812****789', () => {
    expect(maskPhone('08123456789')).toBe('0812****789');
  });

  it('maskPhone: terlalu pendek → ***', () => {
    expect(maskPhone('081')).toBe('***');
  });

  it('maskNim: 2406012*** (prefix tetap terlihat)', () => {
    expect(maskNim('2406012123')).toBe('2406012***');
  });
});
