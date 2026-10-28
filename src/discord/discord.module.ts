import { Global, Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { BotService } from './bot.service';
import { PaymentsModule } from '../payments/payments.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { VouchersModule } from '../vouchers/vouchers.module';

@Global()
@Module({
  imports: [PaymentsModule, FulfillmentModule, VouchersModule],
  providers: [DiscordService, BotService],
  exports: [DiscordService, BotService],
})
export class DiscordModule {}
