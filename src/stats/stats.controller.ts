import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';
import { StatsService } from './stats.service';

/** FR-7.3: statistik dashboard admin. */
@Controller('admin/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Statistik penjualan, kehadiran, pendapatan, kuota' })
  async getStats() {
    return this.stats.getStats();
  }
}
