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
import { isZeroMoney, minMoney, subMoney, addFeePercent } from '../common/utils/money';
import { generateKodeTiket } from '../common/utils/kode-tiket';
import { generatePublicToken } from '../common/utils/public-token';
import { TurnstileService } from './turnstile.service';
import { DiscordService } from '../discord/discord.service';
import { BelibayarClient, describeBelibayarError } from '../payments/belibayar/belibayar.types';
import { PaymentsService } from '../payments/payments.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { CreateOrderDto } from './dto/create-order.dto';

export interface OrderResult {
  tiket: Tiket;
  instruksiBayar: {
    channel: string;
    /** URL halaman pembayaran — kosong untuk QRIS; QR digambar dari qrString. */
    checkoutUrl: string;
    /** String EMV QRIS dinamis — gambar sebagai QRIS asli (qrcode.js/qrious). */
    qrString?: string;
    /** URL PNG QRIS dari provider (alternatif render). */
    qrUrl?: string;
    payCode?: string;
    expiredAt: Date;
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('BelibayarClient') private readonly belibayar: BelibayarClient,
    private readonly discord: DiscordService,
    private readonly events: EventEmitter2,
    private readonly payments: PaymentsService,
    private readonly vouchers: VouchersService,
    private readonly turnstile: TurnstileService,
  ) {}

  async create(dto: CreateOrderDto, options: { captchaToken?: string; ip?: string } = {}): Promise<OrderResult> {
    // Captcha (Cloudflare Turnstile) — anti-bot order; no-op bila secret kosong (dev/test).
    await this.turnstile.verifyOrThrow(options.captchaToken, options.ip);

    const nama = dto.nama.trim();
    const nim = dto.nim.trim();
    const nomorHp = dto.nomorHp.replace(/[\s\-()]/g, '');
    const email = dto.email.trim().toLowerCase();
    const kodeVoucher = dto.kodeVoucher?.trim() || undefined;

    // NIM 10–20 digit angka (keputusan panitia 2026-11: prefix 2406012 tidak lagi diwajibkan).
    if (!/^\d{10,20}$/.test(nim)) {
      throw new HttpException(
        { statusCode: 422, code: 'NIM_TIDAK_VALID', message: 'NIM harus berupa angka 10–20 digit.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!/^(?:\+62|62|0)8\d{7,12}$/.test(nomorHp)) {
      throw new HttpException(
        { statusCode: 422, code: 'NOMOR_HP_TIDAK_VALID', message: 'Nomor HP harus format 08xx / +62.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const hargaTiket = this.config.get<string>('ticketPrice')!;
    const maxTickets = this.config.get<number>('maxTickets')!;
    const expiryMinutes = this.config.get<number>('paymentExpiryMinutes')!;

    // Validasi voucher sebelum transaksi (kontrak VouchersService.validateForPurchase).
    let voucherInfo: { voucherId: number; kode: string; nilai: string } | null = null;
    if (kodeVoucher) {
      const { voucher } = await this.vouchers.validateForPurchase(kodeVoucher);
      voucherInfo = { voucherId: voucher.id, kode: voucher.kodeVoucher, nilai: voucher.nilaiVoucher.toString() };
    }

    const { tiket: reservedTiket, fullCoverOrder } = await this.reserveTicketWithRetry({
      nama,
      nim,
      angkatan: dto.angkatan ?? 2000 + parseInt(nim.slice(0, 2), 10),
      nomorHp,
      email,
      hargaTiket,
      maxTickets,
      voucherInfo,
    });

    let created = reservedTiket;
    let paymentFailed = false;
    let paymentFailure: unknown;

    if (fullCoverOrder && voucherInfo) {
      // Full-cover: setelah commit order, tandai lunas via satu pintu (emits ticket.paid).
      await this.payments.markTicketPaid(
        created.id,
        PAYMENT_METHODS.VOUCHER,
        null,
        `Voucher ${voucherInfo.kode} menutup penuh harga tiket (BR-08)`,
      );
      created =
        (await this.prisma.tiket.findUnique({ where: { id: created.id } })) ?? created;
    } else if (!fullCoverOrder) {
      // Panggil Belibayar DI LUAR transaksi Prisma agar tidak kena timeout 5 detik dan tidak menahan row lock DB.
      try {
        const feePermille = this.config.get<number>('paymentFeePermille') ?? 0;
        const tagihan = feePermille > 0 ? addFeePercent(created.totalBayar.toString(), feePermille) : created.totalBayar.toString();
        const trx = await this.belibayar.createQrisTransaction({
          merchantRef: `${MERCHANT_REF_PREFIX.TIKET}${created.id}`,
          amount: Number(tagihan),
          expiredMinutes: expiryMinutes,
          customerName: nama,
          customerEmail: email,
          customerPhone: nomorHp,
          method: 'qris',
          orderItemName: 'Tiket IGATE',
        });
        created = await this.prisma.tiket.update({
          where: { id: created.id },
          data: {
            dokuInvoiceId: trx.reference,
            dokuCheckoutUrl: trx.checkoutUrl || null,
            qrContent: trx.qrContent ?? null,
            qrUrl: trx.qrUrl ?? null,
          },
        });
      } catch (err) {
        // Belibayar gagal setelah retry → tiket FAILED + WARN (PLAN §T4).
        paymentFailed = true;
        paymentFailure = err;
        created = await this.prisma.tiket.update({
          where: { id: created.id },
          data: { statusPembayaran: TICKET_PAYMENT_STATUS.FAILED },
        });
      }
    }

    if (paymentFailed) {
      // Alasan sebenarnya dicatat: log server memuat cuplikan jawaban Belibayar, alert Discord
      // hanya status/kode + pesan (tanpa isi jawaban).
      this.logger.error(
        `Belibayar gagal untuk TKT-${created.id}: ${describeBelibayarError(paymentFailure, true)}`,
      );
      this.discord.logWarn(
        `Belibayar gagal dibuat untuk order TKT-${created.id} — ${describeBelibayarError(paymentFailure)}; pembeli perlu order ulang`,
      );
      throw new HttpException(
        { statusCode: 502, code: 'BELIBAYAR_GAGAL', message: 'Gagal membuat invoice pembayaran. Coba beberapa saat lagi.' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const instruksiBayar = {
      channel: 'QRIS',
      checkoutUrl: created.dokuCheckoutUrl ?? '',
      qrString: created.qrContent ?? undefined,
      qrUrl: created.qrUrl ?? undefined,
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

  /**
   * Reservasi baris tiket secara atomik & race-safe (BR-03, BR-04, lock voucher).
   * Retry tanpa memverifikasi ulang Turnstile jika terjadi collision kode_tiket (P2002).
   */
  private async reserveTicketWithRetry(
    params: {
      nama: string;
      nim: string;
      angkatan: number;
      nomorHp: string;
      email: string;
      hargaTiket: string;
      maxTickets: number;
      voucherInfo: { voucherId: number; kode: string; nilai: string } | null;
    },
    retriesLeft = 1,
  ): Promise<{ tiket: Tiket; fullCoverOrder: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Gap-lock indeks nim (REPEATABLE READ) → race-safe BR-03 & BR-04.
        await tx.$queryRaw`SELECT id FROM tiket WHERE nim = ${params.nim} FOR UPDATE`;

        const activeCount = await tx.tiket.count({
          where: {
            nim: params.nim,
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
        if (used >= params.maxTickets) {
          throw new HttpException(
            { statusCode: 409, code: 'KUOTA_HABIS', message: 'Kuota tiket sudah habis (BR-04).', sisaKuota: 0 },
            HttpStatus.CONFLICT,
          );
        }

        // Voucher: lock baris voucher agar dua order simultan tak bisa sama-sama pakai.
        if (params.voucherInfo) {
          await tx.$queryRaw`SELECT id FROM voucher WHERE kode_voucher = ${params.voucherInfo.kode} FOR UPDATE`;
          const reserved = await tx.tiket.count({
            where: {
              kodeVoucher: params.voucherInfo.kode,
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
        const harga = params.hargaTiket;
        const diskon = params.voucherInfo ? minMoney(params.voucherInfo.nilai, harga) : '0';
        const totalBayar = params.voucherInfo ? subMoney(harga, diskon) : harga;
        const fullCoverOrder = isZeroMoney(totalBayar);

        const tiket = await tx.tiket.create({
          data: {
            nama: params.nama,
            nim: params.nim,
            angkatan: params.angkatan,
            nomorHp: params.nomorHp,
            email: params.email,
            hargaTiket: harga,
            // Kode tampilan unik — collision acak 6 char ditangani retry (P2002 kode_tiket).
            kodeTiket: generateKodeTiket(),
            // Token acak untuk URL status publik — TKT-{id} tidak lagi diekspos (anti-enumerasi).
            publicToken: generatePublicToken(),
            kodeVoucher: params.voucherInfo?.kode ?? null,
            diskon,
            totalBayar,
            statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID,
            statusTiket: TICKET_STATUS.PENDING,
          },
        });

        return { tiket, fullCoverOrder };
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (
        retriesLeft > 0 &&
        (err as { code?: string })?.code === 'P2002' &&
        (err as { meta?: { target?: string[] } })?.meta?.target?.includes('kode_tiket')
      ) {
        return this.reserveTicketWithRetry(params, retriesLeft - 1);
      }
      throw err;
    }
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

  /** Status publik via token acak 32-char — menggantikan jalur TKT-{id} yang sekuensial. */
  async findByPublicToken(publicToken: string): Promise<Tiket> {
    if (!/^[A-Za-z0-9_-]{32}$/.test(publicToken)) {
      throw new NotFoundException('Order tidak ditemukan.');
    }
    const tiket = await this.prisma.tiket.findUnique({ where: { publicToken } });
    if (!tiket) throw new NotFoundException('Order tidak ditemukan.');
    return tiket;
  }

  /** Detail live untuk instruksi bayar di halaman cek status (FR-2.5).
   *  Tiket pakai QRIS charge: string EMV di-re-fetch agar pembeli bisa ambil ulang QR
   *  kalau halaman ditutup (kolom qr_content di-persist saat create sebagai fallback). */
  async getLiveInstruction(
    tiket: Tiket,
  ): Promise<{ checkoutUrl?: string; qrString?: string; qrUrl?: string }> {
    if (!tiket.dokuInvoiceId) return {};
    try {
      const detail = await this.belibayar.getChargeTransactionDetail(tiket.dokuInvoiceId);
      return {
        checkoutUrl: tiket.dokuCheckoutUrl ?? detail.checkoutUrl,
        qrString: detail.qrContent ?? tiket.qrContent ?? undefined,
        qrUrl: detail.qrUrl ?? tiket.qrUrl ?? undefined,
      };
    } catch {
      return {
        ...(tiket.dokuCheckoutUrl ? { checkoutUrl: tiket.dokuCheckoutUrl } : {}),
        ...(tiket.qrContent ? { qrString: tiket.qrContent } : {}),
        ...(tiket.qrUrl ? { qrUrl: tiket.qrUrl } : {}),
      };
    }
  }

  async adminList(params: {
    status?: string;
    q?: string;
    angkatan?: number;
    page: number;
    pageSize: number;
  }) {
    const where = {
      ...(params.status ? { statusPembayaran: params.status } : {}),
      ...(params.angkatan ? { angkatan: params.angkatan } : {}),
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
