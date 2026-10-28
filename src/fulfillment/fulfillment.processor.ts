import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.module';
import { MERCHANT_REF_PREFIX, TICKET_PAYMENT_STATUS, TICKET_STATUS } from '../common/constants';
import { DiscordService } from '../discord/discord.service';
import { QrService } from './qr.service';
import { PdfService } from './pdf.service';
import { MailService } from './mail.service';
import { FulfillJobData, QUEUE_NAME } from './fulfillment.service';

/** Jeda retry email: 30s → 2m → 10m (backoff 'custom', PLAN §T6). */
export function fulfillmentBackoffStrategy(attemptsMade: number): number {
  return [30_000, 120_000, 600_000][Math.min(attemptsMade - 1, 2)] ?? 600_000;
}

/**
 * Worker fulfillment: qr_token → QR PNG → PDF A5 → storage → SMTP → ISSUED (FR-4.1).
 * Gagal kirim di-retry BullMQ; gagal final → status tetap PAID + logCritical.
 */
@Processor(QUEUE_NAME, {
  settings: { backoffStrategy: fulfillmentBackoffStrategy },
  concurrency: 2,
})
export class FulfillmentProcessor extends WorkerHost {
  private readonly logger = new Logger(FulfillmentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
    private readonly discord: DiscordService,
  ) {
    super();
  }

  async process(job: Job<FulfillJobData>): Promise<string> {
    return this.runFulfillment(job.data.tiketId);
  }

  /** Inti fulfillment — dipisah agar mudah diuji tanpa antrean. */
  async runFulfillment(tiketId: number): Promise<string> {
    let tiket = await this.prisma.tiket.findUnique({ where: { id: tiketId } });
    if (!tiket) return 'SKIPPED_TIDAK_ADA';

    // QR hanya untuk tiket lunas — UNPAID tidak pernah punya token (FR-4.1).
    if (tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.PAID) return 'SKIPPED_BELUM_LUNAS';

    if (!tiket.qrToken) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.tiket.updateMany({
        where: { id: tiketId, qrToken: null },
        data: { qrToken: token },
      });
      tiket = (await this.prisma.tiket.findUnique({ where: { id: tiketId } }))!;
    }

    const merchantRef = `${MERCHANT_REF_PREFIX.TIKET}${tiket.id}`;
    const qrPng = await this.qr.toPngBuffer(tiket.qrToken!);
    const pdf = await this.pdf.buildTicketPdf(tiket, qrPng, merchantRef);
    await this.pdf.saveTicketPdf(tiket.id, pdf);
    await this.mail.sendTicketMail(tiket, merchantRef, pdf);

    await this.prisma.tiket.updateMany({
      where: { id: tiketId, statusTiket: { not: TICKET_STATUS.CHECKED_IN } },
      data: { statusTiket: TICKET_STATUS.ISSUED },
    });

    this.discord.logInfo('TIKET_TERKIRIM', {
      ref: merchantRef,
      nama: tiket.nama,
      email: tiket.email,
    });
    return 'ISSUED';
  }

  /** BullMQ memanggil ini tiap percobaan gagal; logCritical hanya di percobaan final. */
  async onFailed(job: Job<FulfillJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      this.discord.logCritical(
        `EMAIL_GAGAL_FINAL TKT-${job.data.tiketId} setelah ${attempts} percobaan: ${error.message}`,
      );
    } else {
      this.logger.warn(
        `Fulfillment TKT-${job.data.tiketId} gagal (percobaan ${job.attemptsMade}/${attempts}), retry menyusul: ${error.message}`,
      );
    }
  }
}
