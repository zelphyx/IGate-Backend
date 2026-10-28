import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FulfillmentService, QUEUE_NAME } from './fulfillment.service';
import { FulfillmentProcessor } from './fulfillment.processor';
import { FulfillmentAdminController } from './fulfillment-admin.controller';
import { QrService } from './qr.service';
import { PdfService } from './pdf.service';
import { MailService } from './mail.service';

/**
 * Fulfillment (T6): antrean `fulfill` (BullMQ) — qr → pdf → email → ISSUED.
 * Bull Board dipasang manual di main.ts dengan middleware auth superadmin
 * (NFR-05) supaya urutan registrasi Express bisa dikendalikan.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAME })],
  controllers: [FulfillmentAdminController],
  providers: [FulfillmentService, FulfillmentProcessor, QrService, PdfService, MailService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
