import { Module } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VouchersAdminController } from './vouchers-admin.controller';
import { VouchersPublicController } from './vouchers-public.controller';

@Module({
  controllers: [VouchersAdminController, VouchersPublicController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
