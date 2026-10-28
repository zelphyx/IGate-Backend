import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.module';
import { DiscordService } from '../discord/discord.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { TICKET_PAYMENT_STATUS } from '../common/constants';

// @nestjs/event-emitter ESM — di-mock menjadi kelas CJS biasa untuk DI (ts-jest hoist jest.mock)
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class EventEmitter2 {} }));

describe('PaymentsService (T5)', () => {
  let service: PaymentsService;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let tx: any;
  let prisma: any;
  let events: { emit: jest.Mock };
  let discord: { logInfo: jest.Mock; logWarn: jest.Mock; logCritical: jest.Mock };
  let vouchers: { markVoucherPaid: jest.Mock; markVoucherUnpaidStatus: jest.Mock };

  const CONFIG = { maxTickets: 2 };

  function makeTiket(overrides: Record<string, unknown> = {}) {
    return {
      id: 5,
      nama: 'Budi',
      nim: '2406012123',
      hargaTiket: '100000.00',
      diskon: '0.00',
      kodeVoucher: null,
      totalBayar: { toString: () => '100000' },
      statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID,
      dokuInvoiceId: 'TRX123',
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      tiket: {
        findUnique: jest.fn().mockResolvedValue(makeTiket()),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      voucher: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rekap: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      tiket: {
        findUnique: jest.fn().mockResolvedValue(makeTiket()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rekap: { create: jest.fn().mockResolvedValue({}) },
    };
    events = { emit: jest.fn() };
    discord = { logInfo: jest.fn(), logWarn: jest.fn(), logCritical: jest.fn() };
    vouchers = { markVoucherPaid: jest.fn().mockResolvedValue({ processed: true }), markVoucherUnpaidStatus: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k as keyof typeof CONFIG] } },
        { provide: EventEmitter2, useValue: events },
        { provide: DiscordService, useValue: discord },
        { provide: VouchersService, useValue: vouchers },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  });

  describe('markTicketPaid — satu pintu lunas', () => {
    it('UNPAID → PAID: rekap SUCCESS dibuat + event ticket.paid terkirim', async () => {
      const result = await service.markTicketPaid(5, 'QRIS', null, 'Callback Tripay ref=TRX123');
      expect(result.processed).toBe(true);
      expect(tx.tiket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ statusPembayaran: 'PAID' }) }),
      );
      expect(tx.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jenisTransaksi: 'PEMBELIAN_TIKET',
          metodePembayaran: 'QRIS',
          status: 'SUCCESS',
          nominal: expect.objectContaining({ toString: expect.any(Function) }),
        }),
      });
      expect(events.emit).toHaveBeenCalledWith('ticket.paid', { tiketId: 5 });
      expect(discord.logInfo).toHaveBeenCalledWith('PAYMENT_DITERIMA', expect.objectContaining({ ref: 'TKT-5' }));
    });

    it('idempotent: tiket sudah PAID → tanpa efek samping', async () => {
      tx.tiket.findUnique.mockResolvedValue(makeTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.PAID }));
      const result = await service.markTicketPaid(5, 'QRIS', null, 'dobel');
      expect(result).toEqual({ processed: false, reason: 'SUDAH_PAID' });
      expect(events.emit).not.toHaveBeenCalled();
      expect(tx.rekap.create).not.toHaveBeenCalled();
    });

    it('bayar setelah expired + kuota tersedia → direaktivasi jadi PAID (A-7)', async () => {
      tx.tiket.findUnique.mockResolvedValue(makeTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.EXPIRED }));
      const result = await service.markTicketPaid(5, 'QRIS', null, 'telat bayar');
      expect(result.processed).toBe(true);
      expect(tx.tiket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ statusPembayaran: 'PAID' }) }),
      );
      expect(tx.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'SUCCESS', keterangan: expect.stringContaining('reaktivasi') }),
      });
    });

    it('bayar setelah expired + kuota habis → rekap FAILED + butuh refund (A-7)', async () => {
      tx.tiket.findUnique.mockResolvedValue(makeTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.EXPIRED }));
      tx.tiket.count.mockResolvedValue(2); // == maxTickets
      const result = await service.markTicketPaid(5, 'QRIS', null, 'telat bayar');
      expect(result).toEqual({ processed: false, reason: 'KUOTA_HABIS' });
      expect(tx.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', keterangan: expect.stringContaining('refund') }),
      });
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback (FR-3.3)', () => {
    it('callback PAID → markTicketPaid dipanggil dengan metode channel', async () => {
      const spy = jest.spyOn(service, 'markTicketPaid').mockResolvedValue({ processed: true });
      await service.handleCallback(
        JSON.stringify({ reference: 'TRX123', merchant_ref: 'TKT-5', status: 'PAID', payment_method: 'BRIVA' }),
      );
      expect(spy).toHaveBeenCalledWith(5, 'BRIVA', null, expect.stringContaining('TRX123'));
    });

    it('callback EXPIRED → tiket EXPIRED + rekap FAILED', async () => {
      const result = await service.handleCallback(
        JSON.stringify({ reference: 'TRX123', merchant_ref: 'TKT-5', status: 'EXPIRED', payment_method: 'QRIS' }),
      );
      expect(result.success).toBe(true);
      expect(prisma.tiket.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5, statusPembayaran: 'UNPAID' } }),
      );
      expect(prisma.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', keterangan: expect.stringContaining('EXPIRED') }),
      });
    });

    it('merchant_ref tak dikenal → diabaikan, tetap 200', async () => {
      const result = await service.handleCallback(
        JSON.stringify({ reference: 'X', merchant_ref: 'ABC-99', status: 'PAID' }),
      );
      expect(result.success).toBe(true);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('prefix VCH → diteruskan ke VouchersService.markVoucherPaid (T7)', async () => {
      const result = await service.handleCallback(
        JSON.stringify({ reference: 'X', merchant_ref: 'VCH-1', status: 'PAID', payment_method: 'QRIS' }),
      );
      expect(result.success).toBe(true);
      expect(vouchers.markVoucherPaid).toHaveBeenCalledWith(1, 'QRIS', expect.stringContaining('X'));
    });

    it('tiket ber-voucher → rekap keterangan format baku harga/voucher/dibayar (FR-7.1a)', async () => {
      tx.tiket.findUnique.mockResolvedValue(
        makeTiket({ kodeVoucher: 'IGATE-ABCD-2345', totalBayar: { toString: () => '50000.00' } }),
      );
      tx.voucher.findUnique.mockResolvedValue({
        id: 1,
        kodeVoucher: 'IGATE-ABCD-2345',
        nilaiVoucher: { toString: () => '50000.00' },
        status: 'AKTIF',
      });
      await service.markTicketPaid(5, 'QRIS', null, 'Callback Tripay ref=TRX123');
      expect(tx.voucher.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'TERPAKAI' } }),
      );
      expect(tx.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          keterangan: 'harga=100000.00; voucher=IGATE-ABCD-2345(50000.00); dibayar=50000.00',
        }),
      });
    });
  });

  describe('verifyManualOrder (BR-11)', () => {
    const admin = { adminId: 1, email: 'ketua@igate.id' };

    it('UNPAID → verifikasi manual sukses dengan metode MANUAL + audit logCritical', async () => {
      const result = await service.verifyManualOrder(5, admin);
      expect(result.processed).toBe(true);
      expect(tx.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metodePembayaran: 'MANUAL',
          adminId: 1,
          status: 'SUCCESS',
          keterangan: expect.stringContaining('Verifikasi manual'),
        }),
      });
      expect(discord.logCritical).toHaveBeenCalledWith(expect.stringContaining('VERIFIKASI MANUAL TKT-5'));
    });

    it('tiket sudah PAID → idempotent tanpa audit', async () => {
      prisma.tiket.findUnique.mockResolvedValue(makeTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.PAID }));
      const result = await service.verifyManualOrder(5, admin);
      expect(result).toEqual({ processed: false, reason: 'SUDAH_PAID' });
      expect(discord.logCritical).not.toHaveBeenCalled();
    });

    it('tiket tidak ada → 404', async () => {
      prisma.tiket.findUnique.mockResolvedValue(null);
      await expect(service.verifyManualOrder(99, admin)).rejects.toThrow(HttpException);
    });
  });
});
