import { Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';
import { MERCHANT_REF_PREFIX } from '../common/constants';
import { FulfillmentService } from './fulfillment.service';
import { PdfService } from './pdf.service';

/**
 * Endpoint fulfillment sisi admin: kirim ulang email tiket & unduh PDF (PLAN §T6).
 */
@Controller('admin/orders')
export class FulfillmentAdminController {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly pdf: PdfService,
  ) {}

  @Post(':id/resend-email')
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kirim ulang email tiket (hanya tiket lunas)' })
  async resendEmail(@Param('id', ParseIntPipe) id: number) {
    return this.fulfillment.resend(id);
  }

  @Get(':id/ticket-pdf')
  @Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unduh PDF tiket dari storage' })
  async downloadPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const pdf = await this.pdf.readTicketPdf(id);
    if (!pdf) throw new NotFoundException('PDF tiket belum tersedia.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TKT-${id}.pdf"`);
    res.send(pdf);
  }
}
