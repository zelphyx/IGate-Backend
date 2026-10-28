import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Tiket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import {
  TICKET_PAYMENT_STATUS,
  TICKET_STATUS,
  MERCHANT_REF_PREFIX,
  PAYMENT_METHODS,
} from '../common/constants';
import { maskEmail, maskNim, maskPhone } from '../common/utils/mask';
import { isZeroMoney, minMoney, subMoney } from '../common/utils/money';
import { DiscordService } from '../discord/discord.service';
import { TripayClient, TripayError } from '../payments/tripay/tripay.types';
import { PaymentsService } from '../payments/payments.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CreateOrderDto } from './dto/create-order.dto';

export interface OrderResult {
  tiket: Tiket;
  instruksiBayar: {
    channel: string;
    checkoutUrl: string;
    payCode?: string;
    qrUrl?: string;
    expiredAt: Date;
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('TripayClient') private readonly tripay: TripayClient,
    private readonly discord: DiscordService,
    private readonly events: EventEmitter2,
    private readonly payments: PaymentsService,
    private readonly vouchers: VouchersService,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderResult> {
    const nimRegex = this.config.get<RegExp>('nimRegex')!;
    if (!nimRegex.test(dto.nim)) {
      throw new HttpException(
        { statusCode: 422, code: 'NIM_TIDAK_VALID', message: 'NIM harus diawali 2406012 (BR-02).' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!/^(?:\+62|62|0)8\d{7,12}$/.test(dto.nomorHp)) {
      throw new HttpException(
        { statusCode: 422, code: 'NOMOR_HP_TIDAK_VALID', message: 'Nomor HP harus format 08xx / +62.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const hargaTiket = this.config.get<string>('ticketPrice')!;
    const maxTickets = this.config.get<number>('maxTickets')!;
    const expiryMinutes = this.config.get<number>('paymentExpiryMinutes')!;
    const channels = this.config.get<string[]>('tripay.channels') ?? ['QRIS'];

    let created: Tiket;
    let tripayFailed = false;
    let fullCoverOrder = false;

    // Validasi voucher sebelum transaksi (kontrak VouchersService.validateForPurchase).
    let voucherInfo: { voucherId: number; kode: string; nilai: string } | null = null;
    if (dto.kodeVoucher) {
      const { voucher } = await this.vouchers.validateForPurchase(dto.kodeVoucher);
      voucherInfo = { voucherId: voucher.id, kode: voucher.kodeVoucher, nilai: voucher.nilaiVoucher.toString() };
    }

    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Gap-lock indeks nim (REPEATABLE READ) → race-safe BR-03 & BR-04.
        await tx.$queryRaw`SELECT id FROM tiket WHERE nim = ${dto.nim} FOR UPDATE`;

        const activeCount = await tx.tiket.count({
          where: {
            nim: dto.nim,
            statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] },
          },
        });
        if (activeCount > 0) {
          throw new HttpException(
            { statusCode: 409, code: 'NIM_SUDAH_TERDAFTAR', message: 'NIM ini sudah punya tiket aktif (BR-03).' },
            HttpStatus.CONFLICT,
          );
        }
        const used = await tx.tiket.count({
          where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
        });
        if (used >= maxTickets) {
          throw new HttpException(
            { statusCode: 409, code: 'KUOTA_HABIS', message: 'Kuota tiket sudah habis (BR-04).', sisaKuota: 0 },
            HttpStatus.CONFLICT,
          );
        }

        // Voucher: lock baris voucher agar dua order simultan tak bisa sama-sama pakai.
        if (voucherInfo) {
          await tx.$queryRaw`SELECT id FROM voucher WHERE kode_voucher = ${voucherInfo.kode} FOR UPDATE`;
          const reserved = await tx.tiket.count({
            where: {
              kodeVoucher: voucherInfo.kode,
              statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] },
            },
          });
          if (reserved > 0) {
            throw new HttpException(
              { statusCode: 422, code: 'VOUCHER_TERPAKAI', message: 'Voucher sudah dipakai order lain.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
        }

        // Diskon & total (BR-13, tanpa float): diskon = min(nilai voucher, harga).
        const harga = hargaTiket;
        const diskon = voucherInfo ? minMoney(voucherInfo.nilai, harga) : '0';
        const totalBayar = voucherInfo ? subMoney(harga, diskon) : harga;
        fullCoverOrder = isZeroMoney(totalBayar);

        const tiket = await tx.tiket.create({
          data: {
            nama: dto.nama,
            nim: dto.nim,
            angkatan: 2000 + parseInt(dto.nim.slice(0, 2), 10),
            nomorHp: dto.nomorHp,
            email: dto.email.toLowerCase(),
            hargaTiket: harga,
            kodeVoucher: voucherInfo?.kode ?? null,
            diskon,
            totalBayar,
            statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID,
            statusTiket: TICKET_STATUS.PENDING,
          },
        });

        if (fullCoverOrder) {
          // BR-08 full-cover: tanpa invoice Tripay — langsung lunas via voucher (markTicketPaid
          // yang mengonsumsi voucher & membuat rekap format baku, FR-7.1a).
          return tiket;
        }

        try {
          const trx = await this.tripay.createTransaction({
            merchantRef: `${MERCHANT_REF_PREFIX.TIKET}${tiket.id}`,
            amount: Number(totalBayar),
            expiredMinutes: expiryMinutes,
            customerName: dto.nama,
            customerEmail: dto.email,
            customerPhone: dto.nomorHp,
            method: channels[0],
            orderItemName: 'Tiket IGATE',
          });
          return await tx.tiket.update({
            where: { id: tiket.id },
            data: { dokuInvoiceId: trx.reference },
          });
        } catch {
          // Tripay gagal setelah retry → tiket FAILED + WARN (PLAN §T4), rollback dicegah.
          tripayFailed = true;
          return await tx.tiket.update({
            where: { id: tiket.id },
            data: { statusPembayaran: TICKET_PAYMENT_STATUS.FAILED },
          });
        }
      });
    } catch (err) {
      if (err instanceof HttpException) throw err; // validasi/konflik → rollback normal
      throw err;
    }

    // Full-cover: setelah commit order, tandai lunas via satu pintu (emits ticket.paid).
    if (voucherInfo && fullCoverOrder) {
      await this.payments.markTicketPaid(
        created.id,
        PAYMENT_METHODS.VOUCHER,
        null,
        `Voucher ${voucherInfo.kode} menutup penuh harga tiket (BR-08)`,
      );
      created =
        (await this.prisma.tiket.findUnique({ where: { id: created.id } })) ?? created;
    }

    if (tripayFailed) {
      this.discord.logWarn(`Tripay gagal dibuat untuk order TKT-${created.id} (pembeli terblokir sementara)`);
      throw new HttpException(
        { statusCode: 502, code: 'TRIPAY_GAGAL', message: 'Gagal membuat invoice pembayaran. Coba beberapa saat lagi.' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const instruksiBayar = {
      channel: channels[0],
      checkoutUrl: `/api/v1/orders/${MERCHANT_REF_PREFIX.TIKET}${created.id}`, // status-page ambil detail live
      expiredAt: new Date(Date.now() + expiryMinutes * 60_000),
    };

    this.events.emit('order.created', { tiketId: created.id });
    this.discord.logInfo('ORDER_DIBUAT', {
      ref: `${MERCHANT_REF_PREFIX.TIKET}${created.id}`,
      nama: created.nama,
      nim: maskNim(created.nim),
      email: maskEmail(created.email),
      nomorHp: maskPhone(created.nomorHp),
      totalBayar: created.totalBayar.toString(),
    });
    // FR-8.2: alert stok menipis (debounce harian di dalam DiscordService) — tanpa await.
    void this.discord.notifyStock();

    return { tiket: created, instruksiBayar };
  }

  async findByMerchantRef(merchantRef: string): Promise<Tiket> {
    const match = merchantRef.match(new RegExp(`^${MERCHANT_REF_PREFIX.TIKET}(\\d+)$`));
    if (!match) throw new NotFoundException('Order tidak ditemukan.');
    const tiket = await this.prisma.tiket.findUnique({
      where: { id: Number(match[1]) },
    });
    if (!tiket) throw new NotFoundException('Order tidak ditemukan.');
    return tiket;
  }

  /** Detail Tripay live untuk instruksi bayar di halaman cek status (FR-2.5). */
  async getLiveInstruction(tiket: Tiket): Promise<{ checkoutUrl?: string }> {
    if (!tiket.dokuInvoiceId) return {};
    try {
      const detail = await this.tripay.getTransactionDetail(tiket.dokuInvoiceId);
      return { checkoutUrl: detail.checkoutUrl };
    } catch {
      return {};
    }
  }

  async adminList(params: { status?: string; q?: string; page: number; pageSize: number }) {
    const where = {
      ...(params.status ? { statusPembayaran: params.status } : {}),
      ...(params.q
        ? {
            OR: [
              { nama: { contains: params.q } },
              { nim: { contains: params.q } },
              { email: { contains: params.q } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tiket.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.tiket.count({ where }),
    ]);
    return { data, meta: { total, page: params.page, pageSize: params.pageSize } };
  }

  async adminDetail(id: number) {
    const tiket = await this.prisma.tiket.findUnique({
      where: { id },
      include: { rekap: true, checkedByAdmin: { select: { id: true, nama: true, email: true } } },
    });
    if (!tiket) throw new NotFoundException('Tiket tidak ditemukan.');
    return tiket;
  }
}
