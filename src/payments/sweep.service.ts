import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.module';
import {
  REKAP_STATUS,
  TICKET_PAYMENT_STATUS,
  TRANSACTION_TYPES,
  VOUCHER_STATUS,
} from '../common/constants';
import { DiscordService } from '../discord/discord.service';
import { TripayClient } from './tripay/tripay.types';

/**
 * Sweep expiry tiap 1 menit (BR-05): tiket UNPAID melewati batas → EXPIRED
 * + tutup transaksi di sisi Tripay + rekap FAILED. Idempotent lewat update kondisional.
 * Juga menyapu voucher PENDING >6 jam & voucher AKTIF lewat expired_at (FR-5.4).
 */
@Injectable()
export class SweepService {
  private readonly logger = new Logger(SweepService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('TripayClient') private readonly tripay: TripayClient,
    private readonly discord: DiscordService,
  ) {}

  @Cron('* * * * *')
  async sweepExpiredTickets(): Promise<void> {
    if (this.running) return; // cegah tumpang tindih antar tick
    this.running = true;
    try {
      await this.sweepTickets();
      await this.sweepVouchers();
      this.discord.notifyStock(); // alert stok (FR-8.2, debounce harian)
    } finally {
      this.running = false;
    }
  }

  private async sweepTickets(): Promise<void> {
    const expiryMinutes = this.config.get<number>('paymentExpiryMinutes')!;
    const cutoff = new Date(Date.now() - expiryMinutes * 60_000);

    const expired = await this.prisma.tiket.findMany({
      where: { statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID, createdAt: { lt: cutoff } },
      select: { id: true, dokuInvoiceId: true, totalBayar: true },
      take: 200,
    });

    for (const t of expired) {
      if (t.dokuInvoiceId) {
        await this.tripay.closeTransaction(t.dokuInvoiceId).catch((err: Error) =>
          this.logger.warn(`closeTransaction gagal untuk TKT-${t.id}: ${err.message}`),
        );
      }
      const updated = await this.prisma.tiket.updateMany({
        where: { id: t.id, statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID },
        data: { statusPembayaran: TICKET_PAYMENT_STATUS.EXPIRED },
      });
      if (updated.count > 0) {
        await this.prisma.rekap.create({
          data: {
            jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_TIKET,
            nominal: t.totalBayar,
            metodePembayaran: '-',
            status: REKAP_STATUS.FAILED,
            tiketId: t.id,
            keterangan: 'Expired otomatis oleh sweep (BR-05)',
          },
        });
        this.logger.log(`TKT-${t.id} → EXPIRED oleh sweep`);
      }
    }
  }

  /** FR-5.4: voucher PENDING melewati batas bayar → EXPIRED; voucher AKTIF lewat expired_at → EXPIRED. */
  private async sweepVouchers(): Promise<void> {
    const expiryMinutes = this.config.get<number>('paymentExpiryMinutes')!;

    // 1) PENDING tidak dibayar
    const pendingCutoff = new Date(Date.now() - expiryMinutes * 60_000);
    const pending = await this.prisma.voucher.findMany({
      where: { status: VOUCHER_STATUS.PENDING, createdAt: { lt: pendingCutoff } },
      select: { id: true, dokuInvoiceId: true, nilaiVoucher: true },
      take: 200,
    });
    for (const v of pending) {
      if (v.dokuInvoiceId) {
        await this.tripay.closeTransaction(v.dokuInvoiceId).catch((err: Error) =>
          this.logger.warn(`closeTransaction voucher gagal untuk VCH-${v.id}: ${err.message}`),
        );
      }
      const updated = await this.prisma.voucher.updateMany({
        where: { id: v.id, status: VOUCHER_STATUS.PENDING },
        data: { status: VOUCHER_STATUS.EXPIRED },
      });
      if (updated.count > 0) {
        await this.prisma.rekap.create({
          data: {
            jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_VOUCHER,
            nominal: v.nilaiVoucher,
            metodePembayaran: '-',
            status: REKAP_STATUS.FAILED,
            voucherId: v.id,
            keterangan: 'Voucher PENDING kedaluwarsa oleh sweep (FR-5.4)',
          },
        });
        this.logger.log(`VCH-${v.id} → EXPIRED oleh sweep`);
      }
    }

    // 2) AKTIF lewat masa berlaku
    const aktifKedaluwarsa = await this.prisma.voucher.findMany({
      where: { status: VOUCHER_STATUS.AKTIF, expiredAt: { lt: new Date() } },
      select: { id: true, kodeVoucher: true },
      take: 200,
    });
    for (const v of aktifKedaluwarsa) {
      const updated = await this.prisma.voucher.updateMany({
        where: { id: v.id, status: VOUCHER_STATUS.AKTIF },
        data: { status: VOUCHER_STATUS.EXPIRED },
      });
      if (updated.count > 0) this.logger.log(`Voucher ${v.kodeVoucher} → EXPIRED (masa berlaku habis)`);
    }
  }
}
