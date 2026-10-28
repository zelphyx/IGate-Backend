import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES, VOUCHER_STATUS } from '../common/constants';
import { JwtPayload } from '../common/interfaces/jwt-payload';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';

export class ListVouchersQuery {
  @IsOptional()
  @IsIn(Object.values(VOUCHER_STATUS))
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

/**
 * FR-5 (sisi admin): form voucher berbayar, daftar, nonaktifkan.
 */
@Controller('admin/vouchers')
export class VouchersAdminController {
  constructor(private readonly vouchers: VouchersService) {}

  @Post()
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buat voucher berbayar → kode + instruksi bayar (BR-06)' })
  async create(
    @Body() dto: CreateVoucherDto,
    @Request() req: { user: JwtPayload },
  ): Promise<VoucherInstructionLike> {
    return this.vouchers.create(dto, req.user.sub);
  }

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daftar voucher (filter status)' })
  async list(@Query() query: ListVouchersQuery) {
    return this.vouchers.adminList({
      status: query.status,
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 20, 100),
    });
  }

  @Patch(':id/nonaktifkan')
  @Roles(ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nonaktifkan voucher (hanya superadmin, hanya dari AKTIF)' })
  async deactivate(@Param('id', ParseIntPipe) id: number, @Request() req: { user: JwtPayload }) {
    const voucher = await this.vouchers.deactivate(id, req.user.email);
    return { id: voucher.id, kodeVoucher: voucher.kodeVoucher, status: voucher.status };
  }
}

interface VoucherInstructionLike {
  kodeVoucher: string;
  statusPembayaran: string;
  nominal: number;
  instruksiBayar: unknown;
}
