import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ClientIpRequest, resolveClientIp } from './utils/client-ip';

/**
 * Opsi ThrottlerModule: batas global 60 req/menit per IP klien.
 * Kunci "IP klien" ditentukan oleh `resolveClientIp` (lihat catatan keamanan di sana).
 * Batas per-route (`@Throttle`) tetap berlaku dan memakai kunci yang sama.
 */
export function buildThrottlerOptions(config: ConfigService): ThrottlerModuleOptions {
  const trustCloudflareHeader = config.get<boolean>('trustCfConnectingIp') ?? false;
  new Logger('Throttler').log(
    trustCloudflareHeader
      ? 'Rate limit memakai header CF-Connecting-IP (TRUST_CF_CONNECTING_IP=true).'
      : 'Rate limit memakai IP koneksi langsung (TRUST_CF_CONNECTING_IP=false).',
  );
  return {
    throttlers: [{ ttl: 60_000, limit: 60 }],
    getTracker: (req) => resolveClientIp(req as ClientIpRequest, trustCloudflareHeader),
  };
}
