import { Body, Controller, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../common/decorators/public.decorator';
import { DokuCallbackHeaders, DokuClient } from './doku/doku.types';

/** Path Notification URL yang terdaftar di dashboard DOKU — komponen Request-Target signature. */
const NOTIFICATION_TARGET = '/api/v1/payments/callback';

@Public()
@Controller('payments')
export class CallbackController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject('DokuClient') private readonly doku: DokuClient,
  ) {}

  /** Webhook DOKU (HTTP Notification) — HMAC header wajib valid sebelum pemrosesan (FR-3.3). */
  @Post('callback')
  @HttpCode(200)
  async callback(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const headers: DokuCallbackHeaders = {
      clientId: req.headers['client-id'] as string | undefined,
      requestId: req.headers['request-id'] as string | undefined,
      requestTimestamp: req.headers['request-timestamp'] as string | undefined,
      signature: req.headers['signature'] as string | undefined,
    };
    if (!this.doku.verifyCallbackSignature(raw, headers, NOTIFICATION_TARGET)) {
      throw new UnauthorizedException('Signature callback tidak valid.');
    }
    return this.payments.handleCallback(raw);
  }
}
