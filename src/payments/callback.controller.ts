import { Body, Controller, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../common/decorators/public.decorator';
import { TripayClient } from './tripay/tripay.types';

@Public()
@Controller('payments')
export class CallbackController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject('TripayClient') private readonly tripay: TripayClient,
  ) {}

  /** Webhook Tripay — HMAC atas raw body wajib valid sebelum pemrosesan (FR-3.3). */
  @Post('callback')
  @HttpCode(200)
  async callback(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const signature = req.headers['x-callback-signature'] as string | undefined;
    if (!this.tripay.verifyCallbackSignature(raw, signature)) {
      throw new UnauthorizedException('Signature callback tidak valid.');
    }
    return this.payments.handleCallback(raw);
  }
}
