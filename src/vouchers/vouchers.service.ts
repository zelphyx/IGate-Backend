import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Voucher } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import {
  MERCHANT_REF_PREFIX,
  TRANSACTION_TYPES,
  VOUCHER_STATUS,
  REKAP_STATUS,
} from '../common/constants';
import { maskNim, maskPhone } from '../common/utils/mask';
import { toCents } from '../common/utils/money';
import { DiscordService } from '../discord/discord.service';
import { TripayClient } from '../payments/tripay/tripay.types';
import { VOUCHER_CODE_REGEX, generateVoucherCode } from './voucher-code';
import { CreateVoucherDto } from './dto/create-voucher.dto';

export interface VoucherInstruction {
  kodeVoucher: string;
  statusPembayaran: string;
  nominal: number;
  instruksiBayar: {
    channel: string;
    checkoutUrl: string;
    qrUrl?: string;
    expiredAt: Date;
  };
}

/** Error typed untuk validateForPurchase (kontrak Task 8). */
export class VoucherInvalidError extends HttpException {
  constructor(code: string, message: string) {
    super({ statusCode: 422, code, message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('TripayClient') private readonly tripay: TripayClient,
    private readonly discord: DiscordService,
  ) {}

  /** FR-5.1: admin isi form → voucher PENDING → invoice Tripay `VCH-{id}` → kode tampil (FR-5.2). */
  async create(dto: CreateVoucherDto, adminId: number): Promise<VoucherInstruction> {
    const minNominal = this.config.get<string>('voucherMinNominal')!;
    const maxNominal = this.config.get<string>('voucherMaxNominal')!;
    if (
      toCents(String(dto.nominal)) < toCents(minNominal) ||
      toCents(String(dto.nominal)) > toCents(maxNominal)
    ) {
      throw new HttpException(
        {
          statusCode: 422,
          code: 'NOMINAL_TIDAK_VALID',
          message: `Nominal voucher harus antara Rp ${minNominal} dan Rp ${maxNominal} (BR-06).`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const expiryMinutes = this.config.get<number>('paymentExpiryMinutes')!;
    const eventDate = this.config.get<Date | undefined>('eventDate');
    const expiredAt =
      eventDate && eventDate.getTime() > Date.now()
        ? eventDate
        : new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const channels = this.config.get<string[]>('tripay.channels') ?? ['QRIS'];

    let voucher: Voucher;
    let reference: string;
    try {
      const trx = await this.prisma.$transaction(async (tx) => {
        // retry kode bentrok (unique) maksimal 5x
        let created!: Voucher;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            created = await tx.voucher.create({
              data: {
                kodeVoucher: generateVoucherCode(),
                namaPemberi: dto.namaPemberi,
                nim: dto.nim,
                nomorHp: dto.nomorHp,
                nilaiVoucher: String(dto.nominal),
                status: VOUCHER_STATUS.PENDING,
                dibuatOleh: adminId,
                expiredAt,
              },
            });
            break;
          } catch (err) {
            if (attempt === 4) throw err;
          }
        }
        const trx = await this.tripay.createTransaction({
          merchantRef: `${MERCHANT_REF_PREFIX.VOUCHER}${created.id}`,
          amount: dto.nominal,
          expiredMinutes: expiryMinutes,
          customerName: dto.namaPemberi,
          customerEmail: `voucher-${created.kodeVoucher.toLowerCase()}@igate.local`,
          customerPhone: dto.nomorHp,
          method: channels[0],
          orderItemName: `Voucher IGATE ${created.kodeVoucher}`,
        });
        return { created, trx };
      });
      voucher = trx.created;
      reference = trx.trx.reference;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`createTransaction voucher gagal: ${(err as Error).message}`);
      throw new HttpException(
        {
          statusCode: 502,
          code: 'TRIPAY_GAGAL',
          message: 'Gagal membuat invoice pembayaran voucher. Coba beberapa saat lagi.',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.prisma.voucher.update({
      where: { id: voucher.id },
      data: { dokuInvoiceId: reference },
    });

    this.discord.logInfo('VOUCHER_DIBUAT', {
      kode: voucher.kodeVoucher,
      nilai: voucher.nilaiVoucher.toString(),
      pemberi: voucher.namaPemberi,
      nim: maskNim(voucher.nim),
      nomorHp: maskPhone(voucher.nomorHp),
    });

    return {
      kodeVoucher: voucher.kodeVoucher,
      statusPembayaran: VOUCHER_STATUS.PENDING,
      nominal: dto.nominal,
      instruksiBayar: {
        channel: channels[0],
        checkoutUrl: reference ? `tripay:${reference}` : '',
        expiredAt: new Date(Date.now() + expiryMinutes * 60_000),
      },
    };
  }

  /**
   * Kontrak Task 8: validasi kode untuk order tiket.
   * Hanya voucher AKTIF (sudah dibayar) & belum lewat expired_at yang boleh dipakai.
   */
  async validateForPurchase(
    kode: string,
  ): Promise<{ voucher: Voucher; diskon: string }> {
    const normalized = kode.trim().toUpperCase();
    const voucher = await this.prisma.voucher.findUnique({ where: { kodeVoucher: normalized } });
    if (!voucher || !VOUCHER_CODE_REGEX.test(voucher.kodeVoucher)) {
      throw new VoucherInvalidError('VOUCHER_TIDAK_ADA', 'Kode voucher tidak ditemukan.');
    }
    switch (voucher.status) {
      case VOUCHER_STATUS.AKTIF:
        break;
      case VOUCHER_STATUS.PENDING:
        throw new VoucherInvalidError('VOUCHER_PENDING', 'Voucher belum dibayar.');
      case VOUCHER_STATUS.TERPAKAI:
        throw new VoucherInvalidError('VOUCHER_TERPAKAI', 'Voucher sudah pernah dipakai.');
      case VOUCHER_STATUS.EXPIRED:
        throw new VoucherInvalidError('VOUCHER_EXPIRED', 'Voucher sudah kedaluwarsa.');
      case VOUCHER_STATUS.NONAKTIF:
      default:
        throw new VoucherInvalidError('VOUCHER_NONAKTIF', 'Voucher dinonaktifkan admin.');
    }
    if (voucher.expiredAt.getTime() < Date.now()) {
      throw new VoucherInvalidError('VOUCHER_EXPIRED', 'Voucher sudah kedaluwarsa.');
    }
    return { voucher, diskon: voucher.nilaiVoucher.toString() };
  }

  /** Daftar voucher untuk admin (FR-5). */
  async adminList(params: { status?: string; page: number; pageSize: number }) {
    const where = { ...(params.status ? { status: params.status } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.voucher.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { pembuat: { select: { id: true, nama: true } } },
      }),
      this.prisma.voucher.count({ where }),
    ]);
    return { data, meta: { total, page: params.page, pageSize: params.pageSize } };
  }

  /** Nonaktifkan voucher (superadmin) — hanya dari AKTIF (FR-5). */
  async deactivate(voucherId: number, adminEmail: string): Promise<Voucher> {
    const voucher = await this.prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) throw new NotFoundException('Voucher tidak ditemukan.');
    const updated = await this.prisma.voucher.updateMany({
      where: { id: voucherId, status: VOUCHER_STATUS.AKTIF },
      data: { status: VOUCHER_STATUS.NONAKTIF },
    });
    if (updated.count === 0) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'STATUS_TIDAK_BISA_NONAKTIF',
          message: `Voucher berstatus ${voucher.status} tidak bisa dinonaktifkan.`,
        },
        HttpStatus.CONFLICT,
      );
    }
    this.discord.logInfo('VOUCHER_NONAKTIF', {
      kode: voucher.kodeVoucher,
      oleh: adminEmail,
    });
    return { ...voucher, status: VOUCHER_STATUS.NONAKTIF };
  }

  /** Callback PAID `VCH-` → AKTIF + rekap (dipanggil PaymentsService, FR-5.3). */
  async markVoucherPaid(
    voucherId: number,
    metode: string,
    keterangan: string,
  ): Promise<{ processed: boolean; reason?: string }> {
    const voucher = await this.prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) return { processed: false, reason: 'TIDAK_ADA' };
    if (voucher.status === VOUCHER_STATUS.AKTIF) return { processed: false, reason: 'SUDAH_AKTIF' };

    const updated = await this.prisma.voucher.updateMany({
      where: { id: voucherId, status: VOUCHER_STATUS.PENDING },
      data: { status: VOUCHER_STATUS.AKTIF },
    });
    if (updated.count === 0) return { processed: false, reason: `STATUS_${voucher.status}` };

    await this.prisma.rekap.create({
      data: {
        jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_VOUCHER,
        nominal: voucher.nilaiVoucher,
        metodePembayaran: metode,
        status: REKAP_STATUS.SUCCESS,
        voucherId,
        keterangan,
      },
    });
    this.discord.logInfo('VOUCHER_AKTIF', {
      kode: voucher.kodeVoucher,
      nilai: voucher.nilaiVoucher.toString(),
      pemberi: voucher.namaPemberi,
      nim: maskNim(voucher.nim),
    });
    return { processed: true };
  }

  /** Callback EXPIRED/FAILED `VCH-` → voucher EXPIRED + rekap FAILED. */
  async markVoucherUnpaidStatus(
    voucherId: number,
    status: string,
    metode: string,
  ): Promise<{ processed: boolean; reason?: string }> {
    const voucher = await this.prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) return { processed: false, reason: 'TIDAK_ADA' };
    const updated = await this.prisma.voucher.updateMany({
      where: { id: voucherId, status: VOUCHER_STATUS.PENDING },
      data: { status: VOUCHER_STATUS.EXPIRED },
    });
    if (updated.count === 0) return { processed: false, reason: 'TIDAK_DARI_PENDING' };
    await this.prisma.rekap.create({
      data: {
        jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_VOUCHER,
        nominal: voucher.nilaiVoucher,
        metodePembayaran: metode,
        status: REKAP_STATUS.FAILED,
        voucherId,
        keterangan: `Callback Tripay status=${status}`,
      },
    });
    return { processed: true };
  }
}
