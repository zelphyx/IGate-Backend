import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CallbackController } from './callback.controller';
import { PaymentsAdminController } from './payments-admin.controller';
import { SweepService } from './sweep.service';
import { VouchersModule } from '../vouchers/vouchers.module';

@Module({
  imports: [VouchersModule],
  controllers: [CallbackController, PaymentsAdminController],
  providers: [PaymentsService, SweepService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
