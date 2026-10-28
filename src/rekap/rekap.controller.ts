import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { ROLES, REKAP_STATUS, TRANSACTION_TYPES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { RekapService } from './rekap.service';

export class ListRekapQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(Object.values(TRANSACTION_TYPES))
  jenis?: string;

  @IsOptional()
  @IsIn(Object.values(REKAP_STATUS))
  status?: string;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  pageSize?: number = 20;
}

/** FR-7.2: baca ledger rekap keuangan. */
@Controller('admin/rekap')
export class RekapController {
  constructor(private readonly rekap: RekapService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daftar rekap transaksi (filter waktu/jenis/status)' })
  async list(@Query() query: ListRekapQuery) {
    return this.rekap.list({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      jenis: query.jenis,
      status: query.status,
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 20, 100),
    });
  }
}
