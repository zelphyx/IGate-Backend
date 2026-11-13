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
  perAngkatan: PerAngkatanRow[];
}

export interface PerAngkatanRow {
  angkatan: number;
  /** Tiket dengan statusPembayaran UNPAID/PAID/ISSUED/CHECKED_IN (order aktif, termasuk belum lunas). */
  terdaftar: number;
  /** Tiket lunas (PAID/ISSUED/CHECKED_IN). */
  lunas: number;
  /** Tiket sudah check-in. */
  hadir: number;
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
      perAngkatan: await this.perAngkatan(),
    };
  }

  /** Breakdown per angkatan: terdaftar (order aktif), lunas, hadir — untuk progress bar dashboard. */
  private async perAngkatan(): Promise<PerAngkatanRow[]> {
    const rows = await this.prisma.tiket.groupBy({
      by: ['angkatan'],
      where: { statusPembayaran: { notIn: [TICKET_PAYMENT_STATUS.EXPIRED, TICKET_PAYMENT_STATUS.FAILED, TICKET_PAYMENT_STATUS.CANCELED] } },
      _count: { _all: true },
      orderBy: { angkatan: 'asc' },
    });
    // Lunas = statusPembayaran PAID (ISSUED/CHECKED_IN selalu mengikuti PAID di alur normal).
    const lunasRows = await this.prisma.tiket.groupBy({
      by: ['angkatan'],
      where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.PAID] } },
      _count: { _all: true },
    });
    const hadirRows = await this.prisma.tiket.groupBy({
      by: ['angkatan'],
      where: { statusTiket: TICKET_STATUS.CHECKED_IN },
      _count: { _all: true },
    });
    const lunasMap = new Map(lunasRows.map((r) => [r.angkatan, r._count._all]));
    const hadirMap = new Map(hadirRows.map((r) => [r.angkatan, r._count._all]));
    return rows.map((r) => ({
      angkatan: r.angkatan,
      terdaftar: r._count._all,
      lunas: lunasMap.get(r.angkatan) ?? 0,
      hadir: hadirMap.get(r.angkatan) ?? 0,
    }));
  }

  /**
   * Progress "punishment" per angkatan (dipakai khusus 2026): dari total mahasiswa angkatan
   * tsb, berapa % yang sudah beli tiket (lunas) & berapa % yang sudah check-in.
   * % dihitung terhadap totalAnggota (jumlah resmi angkatan, mis. 234) — bukan terhadap
   * pendaftar — sehingga progress bar tidak pernah 100% sebelum semua anggota hadir.
   */
  async angkatanProgress(
    angkatan: number,
    totalAnggota?: number,
  ): Promise<{
    angkatan: number;
    totalAnggota: number;
    terdaftar: number;
    lunas: number;
    hadir: number;
    persenBeli: number;
    persenHadir: number;
    sisaBelumBeli: number;
    sisaBelumHadir: number;
  }> {
    const configTotal = this.config.get<number>('angkatan2026Total') ?? 0;
    const total = totalAnggota ?? (configTotal > 0 ? configTotal : 0);
    const whereAktif = {
      angkatan,
      statusPembayaran: { notIn: [TICKET_PAYMENT_STATUS.EXPIRED, TICKET_PAYMENT_STATUS.FAILED, TICKET_PAYMENT_STATUS.CANCELED] },
    };
    const [terdaftar, lunas, hadir] = await this.prisma.$transaction([
      this.prisma.tiket.count({ where: whereAktif }),
      this.prisma.tiket.count({ where: { angkatan, statusPembayaran: TICKET_PAYMENT_STATUS.PAID } }),
      this.prisma.tiket.count({ where: { angkatan, statusTiket: TICKET_STATUS.CHECKED_IN } }),
    ]);
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      angkatan,
      totalAnggota: total,
      terdaftar,
      lunas,
      hadir,
      persenBeli: pct(lunas),
      persenHadir: pct(hadir),
      sisaBelumBeli: Math.max(total - lunas, 0),
      sisaBelumHadir: Math.max(total - hadir, 0),
    };
  }
}
