import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.module';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';

/** NFR-05: health endpoint mengecek DB & Redis. */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('redisUrl'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  @Get()
  async check(): Promise<{ status: string; db: boolean; redis: boolean }> {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then(() => true).catch(() => false),
    ]);
    return { status: db && redis ? 'ok' : 'degraded', db, redis };
  }
}
