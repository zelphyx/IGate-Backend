import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';

/**
 * Store refresh token di Redis (bukan tabel baru — menjaga ERD tetap 4 tabel).
 * Disimpan sebagai SHA-256 hash dengan TTL 7 hari; rotasi & revoke didukung (FR-1.1).
 */
@Injectable()
export class RefreshTokenStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds = 7 * 24 * 60 * 60;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('redisUrl'));
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(adminId: number): Promise<string> {
    const token = randomBytes(48).toString('hex');
    await this.redis.set(`rt:${RefreshTokenStore.hash(token)}`, String(adminId), 'EX', this.ttlSeconds);
    return token;
  }

  /** Kembalikan adminId pemilik token, atau null jika tidak valid/kedaluwarsa. */
  async resolve(token: string): Promise<number | null> {
    const adminId = await this.redis.get(`rt:${RefreshTokenStore.hash(token)}`);
    return adminId ? Number(adminId) : null;
  }

  async revoke(token: string): Promise<void> {
    await this.redis.del(`rt:${RefreshTokenStore.hash(token)}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
