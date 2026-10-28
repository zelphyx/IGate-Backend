import { Module } from '@nestjs/common';
import { RekapService } from './rekap.service';
import { RekapController } from './rekap.controller';
import { StatsService } from '../stats/stats.service';
import { StatsController } from '../stats/stats.controller';

@Module({
  controllers: [RekapController, StatsController],
  providers: [RekapService, StatsService],
})
export class RekapStatsModule {}
