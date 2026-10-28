import { Body, Controller, Get, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';
import { JwtPayload } from '../common/interfaces/jwt-payload';
import { CheckinService } from './checkin.service';

export class ScanDto {
  @IsString()
  @MaxLength(100)
  qrToken!: string;
}

export class ListCheckinsQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  pageSize?: number = 20;
}

/** FR-6: scan QR & daftar kehadiran (role scanner/admin/superadmin). */
@Controller('admin/checkin')
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Post('scan')
  @Roles(ROLES.SCANNER, ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Scan QR tiket → catat kehadiran (race-safe)' })
  async scan(@Body() dto: ScanDto, @Request() req: { user: JwtPayload }) {
    return this.checkin.scan(dto.qrToken, req.user.sub, req.user.email);
  }
}

@Controller('admin/checkins')
export class CheckinsListController {
  constructor(private readonly checkin: CheckinService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daftar kehadiran (filter rentang waktu)' })
  async list(@Query() query: ListCheckinsQuery) {
    return this.checkin.listCheckins({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 20, 100),
    });
  }
}
