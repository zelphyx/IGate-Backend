import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';

/** FR-7.2: ledger rekap — baris tiket ber-voucher ter-join agar pecahan voucher vs bayar terlihat. */
@Injectable()
export class RekapService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    from?: Date;
    to?: Date;
    jenis?: string;
    status?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.RekapWhereInput = {
      ...(params.jenis ? { jenisTransaksi: params.jenis } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rekap.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: {
          tiket: { select: { id: true, nama: true, nim: true, kodeVoucher: true, diskon: true, totalBayar: true } },
          voucher: { select: { kodeVoucher: true, nilaiVoucher: true } },
          admin: { select: { nama: true } },
        },
      }),
      this.prisma.rekap.count({ where }),
    ]);
    return { data, meta: { total, page: params.page, pageSize: params.pageSize } };
  }
}
