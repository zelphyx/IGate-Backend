import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { Request } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Public } from '../common/decorators/public.decorator';
import { ClientIpRequest, resolveClientIp } from '../common/utils/client-ip';
import { maskEmail, maskNama, maskNimPublic, maskPhone } from '../common/utils/mask';
import { Tiket } from '@prisma/client';

export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  status?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  q?: string;
  /** Tahun angkatan penuh, mis. 2024 (format persis: 4 digit). */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(2000)
  @Max(2100)
  angkatan?: number;
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
  private readonly trustCfConnectingIp: boolean;

  constructor(
    private readonly orders: OrdersService,
    config: ConfigService,
  ) {
    this.trustCfConnectingIp = config.get<boolean>('trustCfConnectingIp') ?? false;
  }

  @Public()
  @ApiOperation({ summary: 'Buat order tiket (FR-2) — wajib lolos Turnstile bila aktif' })
  @Throttle({ default: { ttl: 60_000, limit: 100 } }) // revisi 2026-11: captcha Turnstile jadi lapisan utama anti-bot; limit longgar
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    const clientIp = resolveClientIp(req as ClientIpRequest, this.trustCfConnectingIp);
    const { tiket, instruksiBayar } = await this.orders.create(dto, {
      captchaToken: dto.captchaToken,
      ip: clientIp !== 'unknown' ? clientIp : undefined,
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
  @Throttle({ default: { ttl: 60_000, limit: 120 } }) // cukup untuk polling 3-5 detik termasuk saat berbagi IP NAT
  @Get(':publicToken')
  async status(@Param('publicToken') publicToken: string) {
    const tiket = await this.orders.findByPublicToken(publicToken);
    const instruksi = tiket.statusPembayaran === 'UNPAID' ? await this.orders.getLiveInstruction(tiket) : {};
    return { ...publicView(tiket), instruksiBayar: instruksi };
  }
}
