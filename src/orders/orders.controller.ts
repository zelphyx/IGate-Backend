import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Public } from '../common/decorators/public.decorator';
import { maskEmail, maskNama, maskNimPublic, maskPhone } from '../common/utils/mask';
import { Tiket } from '@prisma/client';

export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() q?: string;
  /** Tahun angkatan penuh, mis. 2024 (format persis: 4 digit). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) angkatan?: number;
}

/** View status publik — PII berat dimasking (revisi keamanan 2026-11): nama & NIM tidak utuh. */
function publicView(tiket: Tiket) {
  return {
    nama: maskNama(tiket.nama),
    nim: maskNimPublic(tiket.nim),
    nomorHp: maskPhone(tiket.nomorHp),
    email: maskEmail(tiket.email),
    hargaTiket: tiket.hargaTiket,
    diskon: tiket.diskon,
    totalBayar: tiket.totalBayar,
    statusPembayaran: tiket.statusPembayaran,
    statusTiket: tiket.statusTiket,
    expiredAt: tiket.paidAt ? undefined : null,
  };
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Public()
  @ApiOperation({ summary: 'Buat order tiket (FR-2) — wajib lolos Turnstile bila aktif' })
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // PRD §12.5: order 5/menit/IP
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto, @Ip() ip: string) {
    const { tiket, instruksiBayar } = await this.orders.create(dto, {
      captchaToken: dto.captchaToken,
      ip,
    });
    return {
      // publicToken = kunci URL status; TKT-{id} internal tidak diekspos (anti-enumerasi).
      publicToken: tiket.publicToken,
      statusPembayaran: tiket.statusPembayaran,
      hargaTiket: tiket.hargaTiket,
      diskon: tiket.diskon,
      totalBayar: tiket.totalBayar,
      instruksiBayar,
    };
  }

  @Public()
  @ApiOperation({ summary: 'Cek status order publik via token acak, PII dimasking (FR-2.5)' })
  @Throttle({ default: { ttl: 60_000, limit: 20 } }) // 20/menit/IP — token dicoba brute tetap jauh di luar ini
  @Get(':publicToken')
  async status(@Param('publicToken') publicToken: string) {
    const tiket = await this.orders.findByPublicToken(publicToken);
    const instruksi = tiket.statusPembayaran === 'UNPAID' ? await this.orders.getLiveInstruction(tiket) : {};
    return { ...publicView(tiket), instruksiBayar: instruksi };
  }
}
