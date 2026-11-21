import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersService } from './orders.service';
import { TurnstileService } from './turnstile.service';
import { PaymentsModule } from '../payments/payments.module';
import { VouchersModule } from '../vouchers/vouchers.module';

@Module({
  imports: [PaymentsModule, VouchersModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersService, TurnstileService],
  exports: [OrdersService, TurnstileService],
})
export class OrdersModule {}
