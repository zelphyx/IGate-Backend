import { resolveClientIp } from './client-ip';

const PROXY_IP = '10.50.0.1';

function req(headers: Record<string, string | string[] | undefined> = {}, ip: string | undefined = PROXY_IP) {
  return { ip, headers };
}

describe('resolveClientIp', () => {
  it('mengabaikan CF-Connecting-IP bila opsi dimatikan (header bisa dipalsukan)', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.7' }), false)).toBe(PROXY_IP);
  });

  it('memakai CF-Connecting-IP IPv4 bila opsi dinyalakan', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.7' }), true)).toBe('203.0.113.7');
  });

  it('memakai CF-Connecting-IP IPv6 dan menormalkan huruf kecil', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '2606:4700:3035::6815:3EB6' }), true)).toBe(
      '2606:4700:3035::6815:3eb6',
    );
  });

  it('memangkas spasi di sekitar nilai header', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '  203.0.113.7 ' }), true)).toBe('203.0.113.7');
  });

  it('mengambil nilai pertama bila header berupa array', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': ['203.0.113.7', '198.51.100.9'] }), true)).toBe(
      '203.0.113.7',
    );
  });

  it.each([
    ['bukan alamat IP', 'bukan-ip'],
    ['daftar IP bergabung', '203.0.113.7, 198.51.100.9'],
    ['string kosong', ''],
    ['IPv4 di luar rentang', '999.1.1.1'],
  ])('jatuh kembali ke req.ip bila header berisi %s', (_label, value) => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': value }), true)).toBe(PROXY_IP);
  });

  it('jatuh kembali ke req.ip bila header tidak ada', () => {
    expect(resolveClientIp(req(), true)).toBe(PROXY_IP);
  });

  it("mengembalikan 'unknown' bila tidak ada header maupun req.ip", () => {
    expect(resolveClientIp({ headers: {} }, true)).toBe('unknown');
  });
});
