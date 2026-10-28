import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { TICKET_PAYMENT_STATUS, TICKET_STATUS } from '../common/constants';
import { maskNim } from '../common/utils/mask';
import { DiscordService } from '../discord/discord.service';

export interface ScanResult {
  nama: string;
  nim: string;
  angkatan: number;
  checkedInAt: Date;
}

/**
 * FR-6: scan QR oleh admin — hanya tiket ISSUED yang bisa check-in.
 * Race-safe: update kondisional `WHERE status_tiket='ISSUED'` → scan ganda tepat satu sukses.
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordService,
  ) {}

  async scan(qrToken: string, adminId: number, adminEmail: string): Promise<ScanResult> {
    const tiket = await this.prisma.tiket.findUnique({
      where: { qrToken },
      include: { checkedByAdmin: { select: { nama: true } } },
    });
    if (!tiket) {
      throw new HttpException(
        { statusCode: 404, code: 'TOKEN_TIDAK_DITEMUKAN', message: 'QR tidak dikenali.' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.PAID) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'BELUM_LUNAS',
          message: `Tiket berstatus ${tiket.statusPembayaran} — belum bisa check-in (FR-6).`,
        },
        HttpStatus.CONFLICT,
      );
    }
    if (tiket.statusTiket !== TICKET_STATUS.ISSUED) {
      if (tiket.statusTiket === TICKET_STATUS.CHECKED_IN) {
        throw new HttpException(
          {
            statusCode: 409,
            code: 'SUDAH_CHECKIN',
            message: `Tiket sudah di-check-in oleh ${tiket.checkedByAdmin?.nama ?? '?'} pada ${tiket.checkedInAt?.toISOString()}.`,
            checkedInAt: tiket.checkedInAt,
            checkedInBy: tiket.checkedByAdmin?.nama,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        { statusCode: 409, code: 'TIKET_BELUM_TERBIT', message: 'Tiket lunas tetapi QR belum terbit.' },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.tiket.updateMany({
      where: { id: tiket.id, statusTiket: TICKET_STATUS.ISSUED },
      data: { statusTiket: TICKET_STATUS.CHECKED_IN, checkedInAt: new Date(), checkedInBy: adminId },
    });
    if (updated.count === 0) {
      // Kalah race dengan scan paralel — ambil kondisi terbaru.
      const fresh = await this.prisma.tiket.findUnique({
        where: { id: tiket.id },
        include: { checkedByAdmin: { select: { nama: true } } },
      });
      throw new HttpException(
        {
          statusCode: 409,
          code: 'SUDAH_CHECKIN',
          message: `Tiket sudah di-check-in oleh ${fresh?.checkedByAdmin?.nama ?? '?'} pada ${fresh?.checkedInAt?.toISOString()}.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    this.discord.logInfo('CHECKIN', {
      ref: `TKT-${tiket.id}`,
      nama: tiket.nama,
      nim: maskNim(tiket.nim),
      oleh: adminEmail,
    });
    return {
      nama: tiket.nama,
      nim: tiket.nim,
      angkatan: tiket.angkatan,
      checkedInAt: tiket.checkedInAt ?? new Date(),
    };
  }

  /** Daftar kehadiran + total (FR-6.2). */
  async listCheckins(params: { from?: Date; to?: Date; page: number; pageSize: number }) {
    const where: Prisma.TiketWhereInput = {
      statusTiket: TICKET_STATUS.CHECKED_IN,
      ...(params.from || params.to
        ? { checkedInAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tiket.findMany({
        where,
        orderBy: { checkedInAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          nama: true,
          nim: true,
          angkatan: true,
          checkedInAt: true,
          checkedByAdmin: { select: { nama: true } },
        },
      }),
      this.prisma.tiket.count({ where }),
    ]);
    return { data, meta: { total, page: params.page, pageSize: params.pageSize } };
  }
}
