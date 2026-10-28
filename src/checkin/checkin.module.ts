import { Module } from '@nestjs/common';
import { CheckinService } from './checkin.service';
import { CheckinController, CheckinsListController } from './checkin.controller';

@Module({
  controllers: [CheckinController, CheckinsListController],
  providers: [CheckinService],
})
export class CheckinModule {}
