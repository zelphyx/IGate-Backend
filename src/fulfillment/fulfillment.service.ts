import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.module';
import { TICKET_PAYMENT_STATUS } from '../common/constants';

export const QUEUE_NAME = 'fulfill';

export interface FulfillJobData {
  tiketId: number;
}

/**
 * Pemicu fulfillment (FR-4): event `ticket.paid` → job antrean `fulfill`.
 * Pengerjaan ulang (resend) memakai job yang sama — worker regenerasi PDF & kirim ulang.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<FulfillJobData>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const redisUrl = config.get<string>('redisUrl');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL kosong — antrean fulfillment tidak akan berjalan.');
    }
  }

  @OnEvent('ticket.paid')
  onTicketPaid(payload: { tiketId: number }): void {
    this.enqueue(payload.tiketId);
  }

  enqueue(tiketId: number): void {
    this.queue
      .add(
        'fulfill',
        { tiketId },
        {
          attempts: 3,
          backoff: { type: 'custom' }, // jeda per percobaan: 30s / 2m / 10m (fulfillment.processor)
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      )
      .catch((err: Error) =>
        this.logger.error(`Gagal enqueue fulfillment TKT-${tiketId}: ${err.message}`),
      );
  }

  /** Resend email tiket (admin) — hanya tiket lunas (PLAN §T6). */
  async resend(tiketId: number): Promise<{ queued: true }> {
    const tiket = await this.prisma.tiket.findUnique({ where: { id: tiketId } });
    if (!tiket) throw new NotFoundException('Tiket tidak ditemukan.');
    if (tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.PAID) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'BELUM_LUNAS',
          message: 'Email hanya bisa dikirim ulang untuk tiket yang sudah lunas.',
        },
        HttpStatus.CONFLICT,
      );
    }
    this.enqueue(tiketId);
    return { queued: true };
  }
}
