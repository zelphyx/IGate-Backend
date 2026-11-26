import { voucherCustomerEmail } from './voucher-email';

describe('voucherCustomerEmail', () => {
  it('memakai kotak surat pengirim dengan tag +voucher-<kode>', () => {
    expect(voucherCustomerEmail('IGATE <igate.psdm@gmail.com>', 'IGATE-L4MB-ZSPZ')).toBe(
      'igate.psdm+voucher-igate-l4mb-zspz@gmail.com',
    );
  });

  it('menerima alamat polos tanpa nama tampilan', () => {
    expect(voucherCustomerEmail('panitia@igate.hmifundip.com', 'ABC-123')).toBe(
      'panitia+voucher-abc-123@igate.hmifundip.com',
    );
  });

  it('membuang tag + yang sudah ada agar tidak bertumpuk', () => {
    expect(voucherCustomerEmail('panitia+lama@mail.id', 'X1')).toBe('panitia+voucher-x1@mail.id');
  });

  it.each([
    ['kosong', undefined],
    ['tanpa @', 'bukan-email'],
    ['domain tanpa titik', 'IGATE <user@localhost>'],
    ['domain .local', 'user@igate.local'],
  ])('jatuh ke example.com bila MAIL_FROM %s', (_label, from) => {
    const email = voucherCustomerEmail(from, 'KODE-1');
    expect(email).toBe('voucher-kode-1@example.com');
  });

  it('tidak pernah menghasilkan domain .local', () => {
    expect(voucherCustomerEmail('IGATE <no-reply@igate.local>', 'K')).not.toMatch(/\.local$/);
  });

  it('membersihkan karakter aneh pada kode voucher', () => {
    expect(voucherCustomerEmail('a@b.id', 'K O/D<E>')).toBe('a+voucher-kode@b.id');
  });
});
