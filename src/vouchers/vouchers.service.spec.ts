import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaymentsService } from '../payments/payments.service';

// @nestjs/event-emitter ESM — di-mock menjadi kelas CJS biasa untuk DI
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class EventEmitter2 {} }));

import { VouchersService, VoucherInvalidError } from './vouchers.service';
import { PrismaService } from '../prisma/prisma.module';
import { DiscordService } from '../discord/discord.service';
import { VOUCHER_STATUS } from '../common/constants';

const CONFIG = {
  voucherMinNominal: '10000',
  voucherMaxNominal: '10000000',
  paymentExpiryMinutes: 360,
  'tripay.channels': ['QRIS'],
  eventDate: undefined,
};

const makeVoucher = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kodeVoucher: 'IGATE-ABCD-2345',
  namaPemberi: 'Sinta',
  nim: '240601212345',
  nomorHp: '081234567890',
  nilaiVoucher: '50000',
  status: VOUCHER_STATUS.PENDING,
  dibuatOleh: 1,
  createdAt: new Date(),
  expiredAt: new Date(Date.now() + 30 * 24 * 3600_000),
  dokuInvoiceId: null,
  ...over,
});

describe('VouchersService (T7)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let service: VouchersService;
  let prisma: any;
  let tripay: { createTransaction: jest.Mock };
  let discord: { logInfo: jest.Mock };

  beforeEach(async () => {
    prisma = {
      voucher: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeVoucher(data))),
        update: jest.fn().mockResolvedValue(makeVoucher()),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rekap: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(prisma)),
    };
    tripay = {
      createTransaction: jest.fn().mockResolvedValue({
        reference: 'TRXV1',
        merchantRef: 'VCH-1',
        checkoutUrl: 'https://tripay.test/VCH-1',
        amount: 50000,
        expiredAt: new Date(),
      }),
    };
    discord = { logInfo: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VouchersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string) => (CONFIG as any)[k] } },
        { provide: 'TripayClient', useValue: tripay },
        { provide: DiscordService, useValue: discord },
      ],
    }).compile();
    service = moduleRef.get(VouchersService);
  });

  const dto = { namaPemberi: 'Sinta', nim: '240601212345', nomorHp: '081234567890', nominal: 50000 };

  it('create sukses → voucher PENDING, invoice VCH-1, rekap belum dibuat', async () => {
    const result = await service.create(dto, 1);
    expect(result.kodeVoucher).toMatch(/^IGATE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(result.statusPembayaran).toBe('PENDING');
    expect(prisma.voucher.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', dibuatOleh: 1 }) }),
    );
    expect(tripay.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ merchantRef: 'VCH-1', amount: 50000 }),
    );
    expect(prisma.rekap.create).not.toHaveBeenCalled();
  });

  it('nominal di bawah minimum → 422 NOMINAL_TIDAK_VALID (BR-06)', async () => {
    await expect(service.create({ ...dto, nominal: 5000 }, 1)).rejects.toMatchObject({
      response: { code: 'NOMINAL_TIDAK_VALID' },
    });
  });

  it('nominal di atas maksimum → 422 (BR-06)', async () => {
    await expect(service.create({ ...dto, nominal: 20_000_000 }, 1)).rejects.toMatchObject({
      response: { code: 'NOMINAL_TIDAK_VALID' },
    });
  });

  it('createTransaction gagal → 502 TRIPAY_GAGAL', async () => {
    tripay.createTransaction.mockRejectedValue(new Error('down'));
    await expect(service.create(dto, 1)).rejects.toMatchObject({ response: { code: 'TRIPAY_GAGAL' } });
  });

  describe('validateForPurchase (kontrak T8)', () => {
    it('kode tak ada → 422 VOUCHER_TIDAK_ADA', async () => {
      prisma.voucher.findUnique.mockResolvedValue(null);
      await expect(service.validateForPurchase('IGATE-XXXX-XXXX')).rejects.toMatchObject({
        response: { code: 'VOUCHER_TIDAK_ADA' },
      });
    });

    it('status TERPAKAI → 422 VOUCHER_TERPAKAI', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher({ status: VOUCHER_STATUS.TERPAKAI }));
      await expect(service.validateForPurchase('IGATE-ABCD-2345')).rejects.toMatchObject({
        response: { code: 'VOUCHER_TERPAKAI' },
      });
    });

    it('status PENDING → 422 VOUCHER_PENDING (belum dibayar)', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher());
      await expect(service.validateForPurchase('IGATE-ABCD-2345')).rejects.toMatchObject({
        response: { code: 'VOUCHER_PENDING' },
      });
    });

    it('lewat expired_at → 422 VOUCHER_EXPIRED', async () => {
      prisma.voucher.findUnique.mockResolvedValue(
        makeVoucher({ status: VOUCHER_STATUS.AKTIF, expiredAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.validateForPurchase('IGATE-ABCD-2345')).rejects.toMatchObject({
        response: { code: 'VOUCHER_EXPIRED' },
      });
    });

    it('AKTIF → lolos dengan nilai voucher', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher({ status: VOUCHER_STATUS.AKTIF }));
      const result = await service.validateForPurchase('IGATE-ABCD-2345');
      expect(result.diskon).toBe('50000');
    });
  });

  describe('callback path', () => {
    it('markVoucherPaid: PENDING → AKTIF + rekap PEMBELIAN_VOUCHER + log VOUCHER_AKTIF', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher());
      const result = await service.markVoucherPaid(1, 'QRIS', 'Callback ref=X');
      expect(result.processed).toBe(true);
      expect(prisma.voucher.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'AKTIF' } }),
      );
      expect(prisma.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jenisTransaksi: 'PEMBELIAN_VOUCHER',
          status: 'SUCCESS',
          voucherId: 1,
        }),
      });
      expect(discord.logInfo).toHaveBeenCalledWith('VOUCHER_AKTIF', expect.any(Object));
    });

    it('markVoucherPaid idempotent: sudah AKTIF → tanpa efek', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher({ status: VOUCHER_STATUS.AKTIF }));
      const result = await service.markVoucherPaid(1, 'QRIS', 'dobel');
      expect(result).toEqual({ processed: false, reason: 'SUDAH_AKTIF' });
      expect(prisma.rekap.create).not.toHaveBeenCalled();
    });

    it('markVoucherUnpaidStatus: PENDING → EXPIRED + rekap FAILED', async () => {
      prisma.voucher.findUnique.mockResolvedValue(makeVoucher());
      const result = await service.markVoucherUnpaidStatus(1, 'EXPIRED', '-');
      expect(result.processed).toBe(true);
      expect(prisma.rekap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED' }),
      });
    });
  });

  it('deactivate: AKTIF → NONAKTIF; status lain → 409', async () => {
    prisma.voucher.findUnique.mockResolvedValue(makeVoucher({ status: VOUCHER_STATUS.AKTIF }));
    const result = await service.deactivate(1, 'ketua@igate.id');
    expect(result.status).toBe('NONAKTIF');

    prisma.voucher.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.deactivate(1, 'ketua@igate.id')).rejects.toMatchObject({
      response: { code: 'STATUS_TIDAK_BISA_NONAKTIF' },
    });
  });

  it('VoucherInvalidError adalah 422 HttpException', () => {
    const err = new VoucherInvalidError('VOUCHER_TIDAK_ADA', 'x');
    expect(err).toBeInstanceOf(HttpException);
  });
});
