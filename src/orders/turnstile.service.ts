import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 10_000;

/**
 * Verifikasi Cloudflare Turnstile (captcha invisible) untuk endpoint publik rawan abuse.
 * - Secret kosong → verifikasi dilewati (dev/test): jangan set TURNSTILE_SECRET_KEY di .env lokal.
 * - Secret diset → token wajib valid, token terpakai/replay ditolak Cloudflare.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('turnstile.secret') ?? '';
  }

  get enabled(): boolean {
    return this.secret.length > 0;
  }

  /** Lempar 403 CAPTCHA_TIDAK_VALID bila verifikasi gagal; no-op bila fitur mati. */
  async verifyOrThrow(token: string | undefined, ip?: string): Promise<void> {
    if (!this.enabled) return;

    if (!token) {
      throw new HttpException(
        {
          statusCode: 403,
          code: 'CAPTCHA_DIBUTUHKAN',
          message: 'Verifikasi captcha wajib diisi.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.set('remoteip', ip);

    let success = false;
    let errorCodes: string[] = [];
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        'error-codes'?: string[];
      };
      success = json.success === true;
      errorCodes = Array.isArray(json['error-codes']) ? json['error-codes'] : [];
      if (!res.ok) {
        this.logger.warn(`Turnstile HTTP ${res.status}, error-codes=${errorCodes.join(',') || '-'}`);
      }
    } catch (err) {
      // Cloudflare down/timeouts → fail-open akan membebani spam; pilihan aman: fail-closed.
      this.logger.error(`Turnstile verify gagal: ${(err as Error).message}`);
      throw new HttpException(
        {
          statusCode: 503,
          code: 'CAPTCHA_TIDAK_TERSEDIA',
          message: 'Verifikasi captcha sedang tidak tersedia. Coba beberapa saat lagi.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!success) {
      this.logger.warn(
        `Turnstile ditolak: error-codes=${errorCodes.join(',') || 'unknown'} remoteip=${ip ?? '-'}`,
      );
      throw new HttpException(
        {
          statusCode: 403,
          code: 'CAPTCHA_TIDAK_VALID',
          message: 'Verifikasi captcha gagal. Muat ulang halaman dan coba lagi.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
