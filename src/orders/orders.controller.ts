import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Public } from '../common/decorators/public.decorator';
import { maskEmail, maskNim, maskPhone } from '../common/utils/mask';
import { Tiket } from '@prisma/client';
import { MERCHANT_REF_PREFIX } from '../common/constants';

export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() q?: string;
}

function publicView(tiket: Tiket) {
  return {
    merchantRef: `${MERCHANT_REF_PREFIX.TIKET}${tiket.id}`,
    nama: tiket.nama,
    nim: maskNim(tiket.nim),
    nomorHp: maskPhone(tiket.nomorHp),
    email: maskEmail(tiket.email),
    hargaTiket: tiket.hargaTiket,
    diskon: tiket.diskon,
    totalBayar: tiket.totalBayar,
    statusPembayaran: tiket.statusPembayaran,
    statusTiket: tiket.statusTiket,
    expiredAt: tiket.paidAt ? undefined : null, // instruksi live menyusul dari Tripay detail
  };
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Public()
  @ApiOperation({ summary: 'Buat order tiket (FR-2)' })
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // PRD §12.5: order 5/menit/IP
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto) {
    const { tiket, instruksiBayar } = await this.orders.create(dto);
    return {
      merchantRef: `${MERCHANT_REF_PREFIX.TIKET}${tiket.id}`,
      statusPembayaran: tiket.statusPembayaran,
      hargaTiket: tiket.hargaTiket,
      diskon: tiket.diskon,
      totalBayar: tiket.totalBayar,
      instruksiBayar,
    };
  }

  @Public()
  @ApiOperation({ summary: 'Cek status order publik, PII dimasking (FR-2.5)' })
  @Get(':merchantRef')
  async status(@Param('merchantRef') merchantRef: string) {
    const tiket = await this.orders.findByMerchantRef(merchantRef);
    const instruksi = tiket.statusPembayaran === 'UNPAID' ? await this.orders.getLiveInstruction(tiket) : {};
    return { ...publicView(tiket), instruksiBayar: instruksi };
  }
}
