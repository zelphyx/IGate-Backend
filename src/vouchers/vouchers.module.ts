import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VouchersAdminController } from './vouchers-admin.controller';

@Module({
  controllers: [VouchersAdminController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
