import { HttpException, NotFoundException } from '@nestjs/common';
import { FulfillmentService } from './fulfillment.service';
import { TICKET_PAYMENT_STATUS } from '../common/constants';

// bullmq/@nestjs/bullmq & @nestjs/event-emitter ESM — di-mock agar spec tidak memuat paket asli
jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));
jest.mock('@nestjs/event-emitter', () => ({ OnEvent: () => () => undefined }));

describe('FulfillmentService', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let queue: { add: jest.Mock };
  let prisma: any;
  let service: FulfillmentService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };
    prisma = { tiket: { findUnique: jest.fn() } };
    service = new FulfillmentService(queue as any, prisma, {
      get: () => 'redis://localhost:6379',
    } as any);
  });

  it('event ticket.paid → job enqueue dengan tiketId', () => {
    service.onTicketPaid({ tiketId: 9 });
    expect(queue.add).toHaveBeenCalledWith(
      'fulfill',
      { tiketId: 9 },
      expect.objectContaining({ attempts: 3, backoff: { type: 'custom' } }),
    );
  });

  it('resend: tiket tak ada → 404', async () => {
    prisma.tiket.findUnique.mockResolvedValue(null);
    await expect(service.resend(99)).rejects.toThrow(NotFoundException);
  });

  it('resend: tiket belum lunas → 409 BELUM_LUNAS', async () => {
    prisma.tiket.findUnique.mockResolvedValue({ id: 1, statusPembayaran: TICKET_PAYMENT_STATUS.UNPAID });
    await expect(service.resend(1)).rejects.toMatchObject({ response: { code: 'BELUM_LUNAS' } });
  });

  it('resend: tiket PAID → enqueue ulang', async () => {
    prisma.tiket.findUnique.mockResolvedValue({ id: 1, statusPembayaran: TICKET_PAYMENT_STATUS.PAID });
    await expect(service.resend(1)).resolves.toEqual({ queued: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('enqueue gagal (redis down) → tidak melempar, hanya log error', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    expect(() => service.onTicketPaid({ tiketId: 9 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
