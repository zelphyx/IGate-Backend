import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { buildThrottlerOptions } from './throttler.config';

/** Route uji dengan batas kecil; `@Throttle` per-route harus tetap memakai pelacak IP dari modul. */
@Controller('ping')
class PingController {
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  ping() {
    return { ok: true };
  }
}

async function createApp(trustCfConnectingIp: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ trustCfConnectingIp })],
      }),
      ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: buildThrottlerOptions }),
    ],
    controllers: [PingController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

const ping = (app: INestApplication, ip?: string) => {
  const r = request(app.getHttpServer()).get('/ping');
  return ip ? r.set('CF-Connecting-IP', ip) : r;
};

describe('buildThrottlerOptions (integrasi dengan ThrottlerGuard)', () => {
  describe('TRUST_CF_CONNECTING_IP=true', () => {
    let app: INestApplication;
    beforeEach(async () => {
      app = await createApp(true);
    });
    afterEach(async () => {
      await app.close();
    });

    it('menghitung kuota terpisah untuk tiap IP klien', async () => {
      await ping(app, '203.0.113.1').expect(200);
      await ping(app, '203.0.113.1').expect(200);
      await ping(app, '203.0.113.1').expect(429);
      // IP lain tidak ikut terblokir
      await ping(app, '203.0.113.2').expect(200);
    });

    it('header tidak valid jatuh ke IP koneksi sehingga berbagi satu kuota', async () => {
      await ping(app, 'bukan-ip').expect(200);
      await ping(app, 'ngawur').expect(200);
      await ping(app, 'lagi-ngawur').expect(429);
    });
  });

  describe('TRUST_CF_CONNECTING_IP=false (default)', () => {
    let app: INestApplication;
    beforeEach(async () => {
      app = await createApp(false);
    });
    afterEach(async () => {
      await app.close();
    });

    it('mengabaikan CF-Connecting-IP sehingga header palsu tidak menghindari batas', async () => {
      await ping(app, '203.0.113.1').expect(200);
      await ping(app, '203.0.113.2').expect(200);
      await ping(app, '203.0.113.3').expect(429);
    });
  });
});
