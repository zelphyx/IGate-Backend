import { Body, Controller, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../common/decorators/public.decorator';
import { BelibayarClient } from './belibayar/belibayar.types';

@Public()
@Controller('payments')
export class CallbackController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject('BelibayarClient') private readonly belibayar: BelibayarClient,
  ) {}

  /**
   * Webhook Belibayar (HTTP Notification)
   * Header: X-Belibayar-Signature: hex(HMAC-SHA256(raw_body, webhook_secret))
   */
  @Post('callback')
  @HttpCode(200)
  async callback(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const signature =
      (req.headers['x-belibayar-signature'] as string | undefined) ??
      (req.headers['signature'] as string | undefined);

    if (!this.belibayar.verifyCallbackSignature(raw, signature)) {
      throw new UnauthorizedException('Signature callback tidak valid.');
    }
    return this.payments.handleCallback(raw);
  }
}
