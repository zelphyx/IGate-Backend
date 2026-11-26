/**
 * Alamat email pelanggan untuk transaksi voucher.
 *
 * Voucher dibuat admin dan tidak punya email pemberi, tetapi Belibayar mewajibkan
 * `customer_email` yang valid. Sebelumnya dipakai `voucher-<kode>@igate.local`; domain `.local`
 * (khusus jaringan lokal) ditolak validasi email sehingga pembuatan voucher gagal dengan
 * "Request body tidak valid". Sekarang alamat dibentuk dari kotak surat pengirim IGATE (MAIL_FROM)
 * dengan tag `+voucher-<kode>`, yang valid dan tetap bermuara ke kotak surat panitia.
 */
export function voucherCustomerEmail(mailFrom: string | undefined, kodeVoucher: string): string {
  const tag = `voucher-${kodeVoucher.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
  const raw = (mailFrom ?? '').trim();
  const address = (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim();
  const at = address.lastIndexOf('@');
  const domain = at > 0 ? address.slice(at + 1) : '';
  // Cukup valid secara bentuk: ada titik di domain, tanpa spasi atau karakter pemisah lain,
  // dan bukan TLD khusus/reserved (.local dkk) yang ditolak validator email.
  const reservedTld = /\.(local|localhost|internal|invalid|test|example|lan|home)$/i;
  if (
    at > 0 &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) &&
    !reservedTld.test(domain) &&
    !/[\s<>,;]/.test(address)
  ) {
    const local = address.slice(0, at).split('+')[0];
    return `${local}+${tag}@${domain}`;
  }
  return `${tag}@example.com`;
}
