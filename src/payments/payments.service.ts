import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.module';
import {
  MERCHANT_REF_PREFIX,
  PAYMENT_METHODS,
  REKAP_STATUS,
  TICKET_PAYMENT_STATUS,
  TRANSACTION_TYPES,
  VOUCHER_STATUS,
} from '../common/constants';
import { maskEmail } from '../common/utils/mask';
import { DiscordService } from '../discord/discord.service';
import { parseCallbackJson } from './tripay/tripay.service';
import { VouchersService } from '../vouchers/vouchers.service';

export interface MarkPaidResult {
  processed: boolean;
  reason?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly discord: DiscordService,
    private readonly vouchers: VouchersService,
  ) {}

  /**
   * Webhook Tripay (FR-3.3): signature diverifikasi oleh pemanggil atas raw body.
   * Idempotent — callback berulang tanpa efek samping, selalu balas sukses agar Tripay berhenti retry.
   */
  async handleCallback(rawBody: Buffer | string): Promise<{ success: true }> {
    const payload = parseCallbackJson(rawBody);

    if (payload.merchant_ref?.startsWith(MERCHANT_REF_PREFIX.VOUCHER)) {
      // Branch voucher (FR-5.3, PLAN §T7)
      const voucherId = Number(payload.merchant_ref.slice(MERCHANT_REF_PREFIX.VOUCHER.length));
      if (!Number.isInteger(voucherId)) {
        this.logger.warn(`Callback merchant_ref tidak dikenal: ${payload.merchant_ref}`);
        return { success: true };
      }
      if (payload.status === TICKET_PAYMENT_STATUS.PAID) {
        const result = await this.vouchers.markVoucherPaid(
          voucherId,
          payload.payment_method ?? '-',
          `Callback Tripay ref=${payload.reference}`,
        );
        if (result.reason === 'TIDAK_ADA') {
          this.logger.warn(`Callback PAID untuk voucher tak dikenal VCH-${voucherId}`);
        }
        return { success: true };
      }
      if (payload.status === TICKET_PAYMENT_STATUS.EXPIRED || payload.status === TICKET_PAYMENT_STATUS.FAILED) {
        await this.vouchers.markVoucherUnpaidStatus(voucherId, payload.status, payload.payment_method ?? '-');
        return { success: true };
      }
      return { success: true }; // status lain diabaikan, tetap 200
    }
    if (!payload.merchant_ref?.startsWith(MERCHANT_REF_PREFIX.TIKET)) {
      this.logger.warn(`Callback merchant_ref tidak dikenal: ${payload.merchant_ref ?? '(kosong)'}`);
      return { success: true };
    }

    const tiketId = Number(payload.merchant_ref.slice(MERCHANT_REF_PREFIX.TIKET.length));
    if (!Number.isInteger(tiketId)) {
      this.logger.warn(`Callback merchant_ref tidak dikenal: ${payload.merchant_ref}`);
      return { success: true };
    }

    if (payload.status === TICKET_PAYMENT_STATUS.PAID) {
      const result = await this.markTicketPaid(
        tiketId,
        payload.payment_method ?? '-',
        null,
        `Callback Tripay ref=${payload.reference}`,
      );
      if (result.reason === 'TIDAK_ADA') {
        this.logger.warn(`Callback PAID untuk tiket tak dikenal TKT-${tiketId}`);
      } else if (result.reason === 'KUOTA_HABIS') {
        this.discord.logCritical(
          `Bayar setelah expired TKT-${tiketId} tapi kuota habis — butuh tindakan manual/refund.`,
        );
      }
      return { success: true };
    }

    if (payload.status === TICKET_PAYMENT_STATUS.EXPIRED || payload.status === TICKET_PAYMENT_STATUS.FAILED) {
      await this.markTicketUnpaidStatus(tiketId, payload.status, payload);
      return { success: true };
    }

    return { success: true }; // status lain diabaikan, tetap 200
  }

  /**
   * SATU PINTU semua jalur tiket lunas: callback Tripay, verifikasi manual superadmin,
   * voucher full-cover Task 8 (PLAN §T5). Idempotent & race-safe lewat transaksi.
   */
  async markTicketPaid(
    tiketId: number,
    metode: string,
    adminId: number | null,
    keterangan: string,
    paidAt?: Date,
  ): Promise<MarkPaidResult> {
    const maxTickets = this.config.get<number>('maxTickets')!;

    const result = await this.prisma.$transaction(async (tx) => {
      const tiket = await tx.tiket.findUnique({ where: { id: tiketId } });
      if (!tiket) return { processed: false, reason: 'TIDAK_ADA' } as MarkPaidResult;

      // Idempotensi: callback dobel / verif ulang → tanpa efek samping (FR-3.3)
      if (tiket.statusPembayaran === TICKET_PAYMENT_STATUS.PAID) {
        return { processed: false, reason: 'SUDAH_PAID' } as MarkPaidResult;
      }

      let keteranganFinal = keterangan;

      if (tiket.statusPembayaran === TICKET_PAYMENT_STATUS.EXPIRED) {
        // A-7: bayar setelah expired → aktifkan lagi hanya jika kuota masih ada
        const used = await tx.tiket.count({
          where: { statusPembayaran: { in: [TICKET_PAYMENT_STATUS.UNPAID, TICKET_PAYMENT_STATUS.PAID] } },
        });
        if (used >= maxTickets) {
          await tx.rekap.create({
            data: {
              jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_TIKET,
              nominal: tiket.totalBayar,
              metodePembayaran: metode,
              status: REKAP_STATUS.FAILED,
              adminId,
              tiketId,
              keterangan: `${keterangan} — bayar setelah expired, kuota habis, butuh refund manual`,
            },
          });
          return { processed: false, reason: 'KUOTA_HABIS' } as MarkPaidResult;
        }
        keteranganFinal = `${keterangan} — reaktivasi setelah expired (kuota tersedia)`;
      }

      if (
        tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.UNPAID &&
        tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.EXPIRED
      ) {
        return { processed: false, reason: `STATUS_${tiket.statusPembayaran}` } as MarkPaidResult;
      }

      await tx.tiket.update({
        where: { id: tiketId },
        data: { statusPembayaran: TICKET_PAYMENT_STATUS.PAID, paidAt: paidAt ?? new Date() },
      });

      // Tiket ber-voucher: konsumsi voucher (AKTIF→TERPAKAI) + rekap format baku (FR-7.1a).
      let keteranganRekap = keteranganFinal;
      if (tiket.kodeVoucher) {
        const voucher = await tx.voucher.findUnique({ where: { kodeVoucher: tiket.kodeVoucher } });
        if (voucher?.status === VOUCHER_STATUS.AKTIF) {
          await tx.voucher.updateMany({
            where: { id: voucher.id, status: VOUCHER_STATUS.AKTIF },
            data: { status: VOUCHER_STATUS.TERPAKAI },
          });
        }
        keteranganRekap =
          `harga=${tiket.hargaTiket}; voucher=${tiket.kodeVoucher}(${voucher?.nilaiVoucher.toString() ?? '?'}); ` +
          `dibayar=${tiket.totalBayar}`;
      }

      await tx.rekap.create({
        data: {
          jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_TIKET,
          nominal: tiket.totalBayar,
          metodePembayaran: metode,
          status: REKAP_STATUS.SUCCESS,
          adminId,
          tiketId,
          keterangan: keteranganRekap,
        },
      });
      return { processed: true } as MarkPaidResult;
    });

    if (result.processed) {
      this.events.emit('ticket.paid', { tiketId });
      const tiket = await this.prisma.tiket.findUnique({ where: { id: tiketId } });
      this.discord.logInfo('PAYMENT_DITERIMA', {
        ref: `${MERCHANT_REF_PREFIX.TIKET}${tiketId}`,
        metode,
        nominal: tiket?.totalBayar.toString() ?? '?',
        nama: tiket?.nama ?? '?',
      });
    }
    return result;
  }

  /** Callback EXPIRED/FAILED → update kondisional (hanya dari UNPAID) + rekap FAILED (FR-3.4). */
  async markTicketUnpaidStatus(
    tiketId: number,
    status: string,
    payload: { payment_method?: string },
  ): Promise<MarkPaidResult> {
    const updated = await this.prisma.tiket.updateMany({
      where: { id: tiketId, statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID },
      data: { statusPembayaran: status },
    });
    if (updated.count === 0) return { processed: false, reason: 'TIDAK_DARI_UNPAID' };

    const tiket = await this.prisma.tiket.findUnique({ where: { id: tiketId } });
    await this.prisma.rekap.create({
      data: {
        jenisTransaksi: TRANSACTION_TYPES.PEMBELIAN_TIKET,
        nominal: tiket?.totalBayar ?? 0,
        metodePembayaran: payload.payment_method ?? '-',
        status: REKAP_STATUS.FAILED,
        tiketId,
        keterangan: `Callback Tripay status=${status}`,
      },
    });
    return { processed: true };
  }

  /** BR-11: konfirmasi manual hanya superadmin, selalu audit Discord + rekap MANUAL. */
  async verifyManualOrder(
    tiketId: number,
    actor: { adminId: number | null; email: string },
  ): Promise<MarkPaidResult> {
    const tiket = await this.prisma.tiket.findUnique({ where: { id: tiketId } });
    if (!tiket) throw new NotFoundException('Tiket tidak ditemukan.');
    if (tiket.statusPembayaran === TICKET_PAYMENT_STATUS.PAID) {
      return { processed: false, reason: 'SUDAH_PAID' };
    }
    if (
      tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.UNPAID &&
      tiket.statusPembayaran !== TICKET_PAYMENT_STATUS.EXPIRED
    ) {
      throw new HttpException(
        {
          statusCode: 409,
          code: 'STATUS_TIDAK_BISA_VERIFIKASI',
          message: `Status ${tiket.statusPembayaran} tidak bisa diverifikasi manual.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.markTicketPaid(
      tiketId,
      PAYMENT_METHODS.MANUAL,
      actor.adminId,
      `Verifikasi manual oleh ${maskEmail(actor.email)}`,
    );
    if (result.processed) {
      this.discord.logCritical(
        `VERIFIKASI MANUAL TKT-${tiketId} oleh ${maskEmail(actor.email)} — nominal ${tiket.totalBayar}`,
      );
    }
    return result;
  }
}
