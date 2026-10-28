import { FulfillmentProcessor, fulfillmentBackoffStrategy } from './fulfillment.processor';
import { TICKET_PAYMENT_STATUS, TICKET_STATUS } from '../common/constants';

// bullmq/@nestjs/bullmq & @nestjs/event-emitter ESM — di-mock agar spec tidak memuat paket asli
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  InjectQueue: () => () => undefined,
  WorkerHost: class WorkerHost {},
}));
jest.mock('@nestjs/event-emitter', () => ({ OnEvent: () => () => undefined }));

const paidTiket = (over: Record<string, unknown> = {}) => ({
  id: 5,
  nama: 'Budi',
  nim: '2406012123',
  angkatan: 2024,
  nomorHp: '08123456789',
  email: 'budi@mail.id',
  hargaTiket: '100000.00',
  kodeVoucher: null,
  diskon: '0.00',
  totalBayar: '100000.00',
  statusPembayaran: TICKET_PAYMENT_STATUS.PAID,
  dokuInvoiceId: 'TRX5',
  qrToken: null,
  statusTiket: TICKET_STATUS.PENDING,
  checkedInAt: null,
  checkedInBy: null,
  createdAt: new Date(),
  paidAt: new Date(),
  ...over,
});

describe('FulfillmentProcessor', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let mail: { sendTicketMail: jest.Mock };
  let discord: { logInfo: jest.Mock; logCritical: jest.Mock };
  let processor: FulfillmentProcessor;

  beforeEach(() => {
    prisma = {
      tiket: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mail = { sendTicketMail: jest.fn().mockResolvedValue(undefined) };
    discord = { logInfo: jest.fn(), logCritical: jest.fn() };
    processor = new FulfillmentProcessor(
      prisma,
      { toPngBuffer: jest.fn().mockResolvedValue(Buffer.from('qr')) } as any,
      {
        buildTicketPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
        saveTicketPdf: jest.fn().mockResolvedValue('/tmp/5.pdf'),
      } as any,
      mail as any,
      discord as any,
    );
  });

  it('tiket UNPAID → skip, tidak pernah dapat qrToken', async () => {
    prisma.tiket.findUnique.mockResolvedValue(paidTiket({ statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID }));
    const result = await processor.runFulfillment(5);
    expect(result).toBe('SKIPPED_BELUM_LUNAS');
    expect(prisma.tiket.updateMany).not.toHaveBeenCalled();
    expect(mail.sendTicketMail).not.toHaveBeenCalled();
  });

  it('tiket PAID tanpa token → token dibuat, PDF tersimpan, email terkirim, ISSUED (FR-4.1)', async () => {
    const row = paidTiket();
    prisma.tiket.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, qrToken: 'a'.repeat(64) });
    const result = await processor.runFulfillment(5);
    expect(result).toBe('ISSUED');
    expect(prisma.tiket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, qrToken: null } }),
    );
    const token = prisma.tiket.updateMany.mock.calls[0][0].data.qrToken;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(mail.sendTicketMail).toHaveBeenCalledTimes(1);
    expect(mail.sendTicketMail.mock.calls[0][1]).toBe('TKT-5');
    expect(prisma.tiket.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { statusTiket: TICKET_STATUS.ISSUED } }),
    );
    expect(discord.logInfo).toHaveBeenCalledWith('TIKET_TERKIRIM', expect.any(Object));
  });

  it('token sudah ada → tidak dibuat ulang (idempotent)', async () => {
    const row = paidTiket({ qrToken: 'b'.repeat(64) });
    prisma.tiket.findUnique.mockResolvedValue(row);
    await processor.runFulfillment(5);
    expect(prisma.tiket.updateMany).toHaveBeenCalledTimes(1); // hanya set ISSUED
  });

  it('gagal final (percobaan terakhir) → logCritical EMAIL_GAGAL_FINAL', async () => {
    const job = { data: { tiketId: 5 }, opts: { attempts: 3 }, attemptsMade: 3 } as any;
    await processor.onFailed(job, new Error('SMTP down'));
    expect(discord.logCritical).toHaveBeenCalledWith(expect.stringContaining('EMAIL_GAGAL_FINAL TKT-5'));
  });

  it('gagal bukan percobaan final → hanya warn, tanpa logCritical', async () => {
    const job = { data: { tiketId: 5 }, opts: { attempts: 3 }, attemptsMade: 1 } as any;
    await processor.onFailed(job, new Error('SMTP down'));
    expect(discord.logCritical).not.toHaveBeenCalled();
  });

  it('backoff custom: 30s → 2m → 10m', () => {
    expect(fulfillmentBackoffStrategy(1)).toBe(30_000);
    expect(fulfillmentBackoffStrategy(2)).toBe(120_000);
    expect(fulfillmentBackoffStrategy(3)).toBe(600_000);
  });
});
