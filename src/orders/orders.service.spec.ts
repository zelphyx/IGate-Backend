import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.module';
import { DiscordService } from '../discord/discord.service';
import { PaymentsService } from '../payments/payments.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { TripayClient } from '../payments/tripay/tripay.types';
import { TICKET_PAYMENT_STATUS } from '../common/constants';

// @nestjs/event-emitter ESM — di-mock menjadi kelas CJS biasa untuk DI (ts-jest hoist jest.mock)
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class EventEmitter2 {} }));

describe('OrdersService (T4+T8)', () => {
  let service: OrdersService;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let tx: any;
  let prisma: any;
  let tripay: { createTransaction: jest.Mock; getTransactionDetail: jest.Mock };
  let discord: { logInfo: jest.Mock; logWarn: jest.Mock; notifyStock: jest.Mock };
  let events: { emit: jest.Mock };
  let payments: { markTicketPaid: jest.Mock };
  let vouchers: { validateForPurchase: jest.Mock };

  const CONFIG: Record<string, unknown> = {
    nimRegex: new RegExp('^2406012\\d{3,4}$'),
    ticketPrice: '100000',
    maxTickets: 2,
    paymentExpiryMinutes: 360,
    'tripay.channels': ['QRIS'],
  };

  const validDto = {
    nama: 'Budi',
    nim: '2406012123',
    nomorHp: '08123456789',
    email: 'budi@mail.id',
  };

  beforeEach(async () => {
    let createdRow: Record<string, unknown> | null = null;
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      tiket: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => {
          createdRow = { id: 7, ...data };
          return Promise.resolve(createdRow);
        }),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ ...createdRow, id: where.id, ...data })),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      tiket: { findUnique: jest.fn() },
    };
    tripay = {
      createTransaction: jest.fn().mockResolvedValue({
        reference: 'TRX123',
        merchantRef: 'TKT-7',
        checkoutUrl: 'https://tripay.test/TKT-7',
        amount: 100000,
        expiredAt: new Date(),
      }),
      getTransactionDetail: jest.fn(),
    };
    discord = { logInfo: jest.fn(), logWarn: jest.fn(), notifyStock: jest.fn() };
    events = { emit: jest.fn() };
    payments = { markTicketPaid: jest.fn().mockResolvedValue({ processed: true }) };
    vouchers = { validateForPurchase: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k] } },
        { provide: 'TripayClient', useValue: tripay },
        { provide: DiscordService, useValue: discord },
        { provide: EventEmitter2, useValue: events },
        { provide: PaymentsService, useValue: payments },
        { provide: VouchersService, useValue: vouchers },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  it('NIM tidak diawali 2406012 → 422 NIM_TIDAK_VALID (BR-02)', async () => {
    await expect(service.create({ ...validDto, nim: '2306012123' })).rejects.toMatchObject({
      response: { code: 'NIM_TIDAK_VALID' },
    });
  });

  it('NIM format benar tapi panjang salah → 422', async () => {
    await expect(service.create({ ...validDto, nim: '240601212' })).rejects.toMatchObject({
      response: { code: 'NIM_TIDAK_VALID' },
    });
  });

  it('NIM sudah punya tiket aktif → 409 NIM_SUDAH_TERDAFTAR (BR-03)', async () => {
    tx.tiket.count.mockResolvedValueOnce(1); // activeCount nim
    await expect(service.create(validDto)).rejects.toMatchObject({
      response: { code: 'NIM_SUDAH_TERDAFTAR' },
    });
  });

  it('kuota habis → 409 KUOTA_HABIS (BR-04)', async () => {
    tx.tiket.count
      .mockResolvedValueOnce(0) // activeCount nim
      .mockResolvedValueOnce(2); // used >= maxTickets
    await expect(service.create(validDto)).rejects.toMatchObject({
      response: { code: 'KUOTA_HABIS' },
    });
  });

  it('nomor HP format salah → 422', async () => {
    await expect(service.create({ ...validDto, nomorHp: '12345' })).rejects.toMatchObject({
      response: { code: 'NOMOR_HP_TIDAK_VALID' },
    });
  });

  it('order sukses → tiket UNPAID, angkatan 2024, reference tersimpan, event + log Discord', async () => {
    const result = await service.create(validDto);
    expect(result.tiket.statusPembayaran).toBe(TICKET_PAYMENT_STATUS.UNPAID);
    expect(result.tiket.angkatan).toBe(2024);
    expect(result.tiket.dokuInvoiceId).toBe('TRX123');
    expect(tripay.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ merchantRef: 'TKT-7', amount: 100000 }),
    );
    expect(events.emit).toHaveBeenCalledWith('order.created', { tiketId: 7 });
    expect(discord.logInfo).toHaveBeenCalledWith('ORDER_DIBUAT', expect.objectContaining({ ref: 'TKT-7' }));
  });

  it('Tripay gagal → tiket FAILED + logWarn, lalu 502 TRIPAY_GAGAL', async () => {
    tripay.createTransaction.mockRejectedValue(new Error('network down'));
    await expect(service.create(validDto)).rejects.toMatchObject({ response: { code: 'TRIPAY_GAGAL' } });
    expect(tx.tiket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusPembayaran: 'FAILED' }) }),
    );
    expect(discord.logWarn).toHaveBeenCalled();
  });

  it('findByMerchantRef: ref tidak valid → 404', async () => {
    await expect(service.findByMerchantRef('XXX-1')).rejects.toThrow(HttpException);
  });

  // ── T8: pemakaian voucher ────────────────────────────────────────────────

  it('voucher TIDAK ADA → 422 sebelum transaksi', async () => {
    vouchers.validateForPurchase.mockRejectedValue(
      new HttpException(
        { statusCode: 422, code: 'VOUCHER_TIDAK_ADA' },
        422,
      ),
    );
    await expect(service.create({ ...validDto, kodeVoucher: 'IGATE-XXXX-XXXX' })).rejects.toMatchObject({
      response: { code: 'VOUCHER_TIDAK_ADA' },
    });
  });

  it('voucher 50k / tiket 100k → diskon 50k, bayar 50k, invoice Tripay senilai 50k', async () => {
    vouchers.validateForPurchase.mockResolvedValue({
      voucher: { id: 1, kodeVoucher: 'IGATE-ABCD-2345', nilaiVoucher: '50000', status: 'AKTIF' },
      diskon: '50000',
    });
    const result = await service.create({ ...validDto, kodeVoucher: 'IGATE-ABCD-2345' });
    expect(result.tiket.diskon).toBe('50000.00');
    expect(result.tiket.totalBayar).toBe('50000.00');
    expect(result.tiket.kodeVoucher).toBe('IGATE-ABCD-2345');
    expect(tripay.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000 }),
    );
    expect(payments.markTicketPaid).not.toHaveBeenCalled();
  });

  it('voucher full-cover 100k → tanpa createTransaction, langsung markTicketPaid VOCHER (BR-08)', async () => {
    vouchers.validateForPurchase.mockResolvedValue({
      voucher: { id: 1, kodeVoucher: 'IGATE-FULL-2345', nilaiVoucher: '100000', status: 'AKTIF' },
      diskon: '100000',
    });
    const created = {
      id: 7, nama: 'Budi', nim: '2406012123', nomorHp: '08123456789', email: 'budi@mail.id',
      totalBayar: '0.00', statusPembayaran: 'PAID', statusTiket: 'PENDING', kodeVoucher: 'IGATE-FULL-2345',
    };
    prisma.tiket.findUnique.mockResolvedValue(created);
    const result = await service.create({ ...validDto, kodeVoucher: 'IGATE-FULL-2345' });
    expect(result.tiket.totalBayar).toBe('0.00');
    expect(tripay.createTransaction).not.toHaveBeenCalled();
    expect(payments.markTicketPaid).toHaveBeenCalledWith(
      7,
      'VOUCHER',
      null,
      expect.stringContaining('IGATE-FULL-2345'),
    );
    expect(result.tiket.statusPembayaran).toBe('PAID');
  });

  it('voucher 150k / tiket 100k → bayar 0, sisa hangus (BR-08)', async () => {
    vouchers.validateForPurchase.mockResolvedValue({
      voucher: { id: 1, kodeVoucher: 'IGATE-BIGG-2345', nilaiVoucher: '150000', status: 'AKTIF' },
      diskon: '150000',
    });
    const created = {
      id: 7, nama: 'Budi', nim: '2406012123', nomorHp: '08123456789', email: 'budi@mail.id',
      totalBayar: '0.00', diskon: '100000.00', statusPembayaran: 'PAID', statusTiket: 'PENDING',
    };
    prisma.tiket.findUnique.mockResolvedValue(created);
    const result = await service.create({ ...validDto, kodeVoucher: 'IGATE-BIGG-2345' });
    expect(result.tiket.diskon).toBe('100000.00'); // hangus melebihi harga
    expect(result.tiket.totalBayar).toBe('0.00');
    expect(payments.markTicketPaid).toHaveBeenCalled();
  });

  it('voucher sudah dipakai order lain → 422 VOUCHER_TERPAKAI', async () => {
    vouchers.validateForPurchase.mockResolvedValue({
      voucher: { id: 1, kodeVoucher: 'IGATE-USE2-2345', nilaiVoucher: '50000', status: 'AKTIF' },
      diskon: '50000',
    });
    tx.tiket.count = jest
      .fn()
      .mockResolvedValueOnce(0) // activeCount nim
      .mockResolvedValueOnce(0) // kuota
      .mockResolvedValueOnce(1); // reserved — tiket lain pegang voucher
    await expect(service.create({ ...validDto, kodeVoucher: 'IGATE-USE2-2345' })).rejects.toMatchObject({
      response: { code: 'VOUCHER_TERPAKAI' },
    });
  });
});
