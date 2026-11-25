import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';

jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class EventEmitter2 {} }));

import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CreateVoucherDto } from '../vouchers/dto/create-voucher.dto';
import { ListVouchersQuery } from '../vouchers/vouchers-admin.controller';

describe('OrdersController & DTO normalization', () => {
  it('create() meneruskan CF-Connecting-IP ke OrdersService saat trustCfConnectingIp=true', async () => {
    const createMock = jest.fn().mockResolvedValue({
      tiket: {
        publicToken: 'a'.repeat(32),
        statusPembayaran: 'UNPAID',
        hargaTiket: '45000',
        diskon: '0',
        totalBayar: '45000',
      },
      instruksiBayar: { channel: 'QRIS', checkoutUrl: '', expiredAt: new Date() },
    });

    const mod = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: { create: createMock } },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'trustCfConnectingIp' ? true : undefined) } },
      ],
    }).compile();

    const controller = mod.get(OrdersController);
    const req = { ip: '10.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.55' } } as unknown as Request;
    await controller.create(
      { nama: 'Budi', nim: '2406012123001', nomorHp: '081234567890', email: 'budi@mail.id', captchaToken: 'tok' },
      req,
    );

    expect(createMock).toHaveBeenCalledWith(expect.any(Object), {
      captchaToken: 'tok',
      ip: '203.0.113.55',
    });
  });

  it('CreateOrderDto membersihkan spasi/strip autofill & string kosong opsional', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const dto = (await pipe.transform(
      {
        nama: '  Budi  ',
        nim: ' 2406012123001 ',
        nomorHp: '+62 812-3456-7890',
        email: ' budi@mail.id ',
        angkatan: '',
        kodeVoucher: '   ',
      },
      { type: 'body', metatype: CreateOrderDto },
    )) as CreateOrderDto;

    expect(dto.nama).toBe('Budi');
    expect(dto.nim).toBe('2406012123001');
    expect(dto.nomorHp).toBe('+6281234567890');
    expect(dto.email).toBe('budi@mail.id');
    expect(dto.angkatan).toBeUndefined();
    expect(dto.kodeVoucher).toBeUndefined();
  });

  it('CreateVoucherDto membersihkan spasi/strip nomorHp & ListVouchersQuery menerima status kosong', async () => {
    const voucherDto = plainToInstance(CreateVoucherDto, {
      namaPemberi: ' Sinta ',
      nim: ' 24060121234567 ',
      nomorHp: '0812 3456-7890',
      nominal: 25000,
    });
    expect(await validate(voucherDto)).toHaveLength(0);
    expect(voucherDto.nomorHp).toBe('081234567890');

    const queryDto = plainToInstance(ListVouchersQuery, { status: '' });
    expect(await validate(queryDto)).toHaveLength(0);
    expect(queryDto.status).toBeUndefined();
  });
});
