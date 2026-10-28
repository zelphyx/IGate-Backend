import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { REKAP_STATUS, TICKET_PAYMENT_STATUS, TICKET_STATUS, VOUCHER_STATUS } from '../common/constants';
import { PrismaService } from '../prisma/prisma.module';

export interface StatsResult {
  terjual: number;
  perStatus: {
    UNPAID: number;
    PAID: number;
    ISSUED: number;
    CHECKED_IN: number;
    EXPIRED: number;
  };
  checkin: number;
  pendapatan: { total: string; hariIni: string };
  sisaKuota: number;
  voucher: { aktif: number; terpakai: number };
}

/** Tanggal awal hari ini menurut zona Asia/Jakarta (+07:00). */
export function startOfTodayJakarta(now = new Date()): Date {
  const jakartaNow = new Date(now.getTime() + 7 * 3600_000);
  return new Date(
    Date.UTC(jakartaNow.getUTCFullYear(), jakartaNow.getUTCMonth(), jakartaNow.getUTCDate()) -
      7 * 3600_000,
  );
}

/**
 * FR-7.3: statistik dashboard — angka konsisten dengan rekap (sumber: tiket + rekap SUCCESS).
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getStats(): Promise<StatsResult> {
    const maxTickets = this.config.get<number>('maxTickets')!;

    const [
      unpaid,
      paidPending,
      issued,
      checkedIn,
      expired,
      rekapTotal,
      rekapHariIni,
      used,
      voucherAktif,
      voucherTerpakai,
    ] = await this.prisma.$transaction([
      this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID } }),
      this.prisma.tiket.count({
        where: { statusPembayaran: TICKET_PAYMENT_STATUS.PAID, statusTiket: TICKET_STATUS.PENDING },
      }),
      this.prisma.tiket.count({ where: { statusTiket: TICKET_STATUS.ISSUED } }),
      this.prisma.tiket.count({ where: { statusTiket: TICKET_STATUS.CHECKED_IN } }),
      this.prisma.tiket.count({ where: { statusPembayaran: TICKET_PAYMENT_STATUS.EXPIRED } }),
      this.prisma.rekap.aggregate({
        _sum: { nominal: true },
        where: { status: REKAP_STATUS.SUCCESS },
      }),
      this.prisma.rekap.aggregate({
        _sum: { nominal: true },
        where: { status: REKAP_STATUS.SUCCESS, createdAt: { gte: startOfTodayJakarta() } },
      }),
      this.prisma.tiket.count({
        where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
      }),
      this.prisma.voucher.count({ where: { status: VOUCHER_STATUS.AKTIF } }),
      this.prisma.voucher.count({ where: { status: VOUCHER_STATUS.TERPAKAI } }),
    ]);

    const fmt = (v: Prisma.Decimal | null) => v?.toString() ?? '0';
    return {
      terjual: issued + checkedIn + paidPending,
      perStatus: {
        UNPAID: unpaid,
        PAID: paidPending,
        ISSUED: issued,
        CHECKED_IN: checkedIn,
        EXPIRED: expired,
      },
      checkin: checkedIn,
      pendapatan: { total: fmt(rekapTotal._sum.nominal), hariIni: fmt(rekapHariIni._sum.nominal) },
      sisaKuota: Math.max(maxTickets - used, 0),
      voucher: { aktif: voucherAktif, terpakai: voucherTerpakai },
    };
  }
}
