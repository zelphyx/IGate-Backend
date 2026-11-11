import { isIP } from 'node:net';

/** Bentuk minimal request yang dibutuhkan (cukup untuk Express maupun unit test tanpa server). */
export interface ClientIpRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * IP klien yang dipakai sebagai kunci rate limit.
 *
 * Di produksi request melewati Cloudflare → Caddy VPS → WireGuard → Caddy fisik → aplikasi, sehingga
 * `req.ip` selalu IP proxy terdekat dan seluruh pengunjung berbagi satu kuota (mis. "5 order/menit/IP"
 * menjadi 5 order/menit untuk semua orang). `trust proxy` berbasis jumlah hop tidak andal di sini karena
 * Caddy mengabaikan/menimpa X-Forwarded-For dari klien kecuali `trusted_proxies` dikonfigurasi.
 * Cloudflare mengisi `CF-Connecting-IP` dengan IP klien, dan Caddy meneruskan header itu apa adanya.
 *
 * KEAMANAN: header ini hanya boleh dipercaya bila origin HANYA bisa dijangkau dari Cloudflare. Penyerang
 * yang menembus langsung ke origin dapat memalsukannya (menghindari rate limit atau memicu limit atas
 * IP orang lain). Karena itu pemakaiannya opt-in lewat TRUST_CF_CONNECTING_IP (default mati). Nilai yang
 * bukan alamat IP valid diabaikan dan jatuh kembali ke `req.ip`.
 */
export function resolveClientIp(req: ClientIpRequest, trustCloudflareHeader: boolean): string {
  if (trustCloudflareHeader) {
    const raw = req.headers['cf-connecting-ip'];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && isIP(value) !== 0) return value.toLowerCase();
  }
  return req.ip ?? 'unknown';
}
