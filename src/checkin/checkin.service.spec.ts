import { HttpException } from '@nestjs/common';
import { CheckinService } from './checkin.service';
import { TICKET_PAYMENT_STATUS, TICKET_STATUS } from '../common/constants';

const makeTiket = (over: Record<string, unknown> = {}) => ({
  id: 5,
  nama: 'Budi',
  nim: '2406012123',
  angkatan: 2024,
  statusPembayaran: TICKET_PAYMENT_STATUS.PAID,
  statusTiket: TICKET_STATUS.ISSUED,
  qrToken: 'a'.repeat(64),
  checkedInAt: null,
  checkedInBy: null,
  checkedByAdmin: null,
  ...over,
});

describe('CheckinService (T9)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let discord: { logInfo: jest.Mock };
  let service: CheckinService;

  beforeEach(() => {
    prisma = {
      tiket: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((arr: unknown[]) => Promise.resolve([[], 0])),
    };
    discord = { logInfo: jest.fn() };
    service = new CheckinService(prisma, discord as any);
  });

  it('token tidak ditemukan → 404 TOKEN_TIDAK_DITEMUKAN', async () => {
    prisma.tiket.findUnique.mockResolvedValue(null);
    await expect(service.scan('nope', 1, 'a@b.c')).rejects.toMatchObject({
      response: { code: 'TOKEN_TIDAK_DITEMUKAN' },
    });
  });

  it('tiket UNPAID → 409 BELUM_LUNAS', async () => {
    prisma.tiket.findUnique.mockResolvedValue(makeTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID }));
    await expect(service.scan('tok', 1, 'a@b.c')).rejects.toMatchObject({
      response: { code: 'BELUM_LUNAS' },
    });
  });

  it('tiket PAID tapi belum terbit → 409 TIKET_BELUM_TERBIT', async () => {
    prisma.tiket.findUnique.mockResolvedValue(makeTiket({ statusTiket: TICKET_STATUS.PENDING }));
    await expect(service.scan('tok', 1, 'a@b.c')).rejects.toMatchObject({
      response: { code: 'TIKET_BELUM_TERBIT' },
    });
  });

  it('sudah check-in → 409 SUDAH_CHECKIN dengan siapa & kapan', async () => {
    prisma.tiket.findUnique.mockResolvedValue(
      makeTiket({
        statusTiket: TICKET_STATUS.CHECKED_IN,
        checkedInAt: new Date('2026-08-01T03:00:00Z'),
        checkedByAdmin: { nama: 'Rani' },
      }),
    );
    await expect(service.scan('tok', 1, 'a@b.c')).rejects.toMatchObject({
      response: { code: 'SUDAH_CHECKIN' },
    });
  });

  it('scan sukses → CHECKED_IN + checkedInBy dari JWT (bukan body) + log', async () => {
    prisma.tiket.findUnique.mockResolvedValue(makeTiket());
    const result = await service.scan('tok', 7, 'scanner@igate.id');
    expect(prisma.tiket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, statusTiket: TICKET_STATUS.ISSUED },
        data: expect.objectContaining({ checkedInBy: 7 }),
      }),
    );
    expect(result.nama).toBe('Budi');
    expect(result.angkatan).toBe(2024);
    expect(discord.logInfo).toHaveBeenCalledWith('CHECKIN', expect.any(Object));
  });

  it('dua scan paralel → kalah race mendapat SUDAH_CHECKIN', async () => {
    prisma.tiket.findUnique.mockResolvedValue(makeTiket());
    prisma.tiket.updateMany.mockResolvedValue({ count: 0 }); // kalah race
    await expect(service.scan('tok', 7, 's@i.id')).rejects.toMatchObject({
      response: { code: 'SUDAH_CHECKIN' },
    });
  });
});
