import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { Request, Response, NextFunction } from 'express';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAME } from './fulfillment/fulfillment.service';
import { AppModule } from './app.module';

/** Guard Bull Board: hanya accessToken JWT role superadmin (NFR-05). */
function bullBoardAuthHandler(
  jwt: JwtService,
  secret: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ statusCode: 401, message: 'Autentikasi diperlukan.' });
      return;
    }
    try {
      const payload = jwt.verify(token, { secret }) as { role?: string };
      if (payload.role !== 'superadmin') {
        res.status(403).json({ statusCode: 403, message: 'Hanya superadmin.' });
        return;
      }
      next();
    } catch {
      res.status(401).json({ statusCode: 401, message: 'Token tidak valid.' });
    }
  };
}

async function bootstrap(): Promise<void> {
  // rawBody: true → HMAC verifikasi callback Tripay atas body mentah (FR-3.2)
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableShutdownHooks();

  const config = app.get(ConfigService);

  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Bull Board: inspeksi antrean, hanya superadmin (dipasang manual agar urutan
  // middleware Express terkendali dan auth tak bisa dilewati).
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/api/v1/admin/queues');
  const fulfillQueue = app.get(getQueueToken(QUEUE_NAME));
  createBullBoard({ queues: [new BullMQAdapter(fulfillQueue as never)], serverAdapter });
  const jwt = app.get(JwtService);
  app.use(
    '/api/v1/admin/queues',
    bullBoardAuthHandler(jwt, config.get<string>('jwtSecret')!),
  );
  app.use('/api/v1/admin/queues', serverAdapter.getRouter());

  if (config.get('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ticketing IGATE API')
      .setDescription('Backend pemesanan tiket IGATE (PRD docs/PRD.md)')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(config.get<number>('port') ?? 3000);
}
void bootstrap();
