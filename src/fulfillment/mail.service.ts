import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Tiket } from '@prisma/client';

/**
 * Pengirim email tiket (SMTP injectable agar mudah di-mock di test).
 * SMTP_HOST kosong → transport "log" (dev/e2e tanpa SMTP): isi email hanya dicatat
 * di log aplikasi, sehingga alur fulfillment tetap bisa diverifikasi.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: ReturnType<typeof nodemailer.createTransport>;
  private readonly host?: string;
  private readonly from?: string;

  constructor(config: ConfigService) {
    this.host = config.get<string>('smtp.host') || undefined;
    this.from = config.get<string>('smtp.from') || undefined;
    const port = config.get<number>('smtp.port') ?? 587;
    const user = config.get<string>('smtp.user');
    const pass = config.get<string>('smtp.pass');
    if (this.host) {
      this.transporter = nodemailer.createTransport({
        host: this.host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      });
    }
  }

  async sendTicketMail(tiket: Tiket, merchantRef: string, pdf: Buffer): Promise<void> {
    const subject = `Tiket IGATE ${merchantRef} — pembayaran diterima`;
    if (!this.transporter) {
      this.logger.log(
        `[MAIL:LOG-TRANSPORT] → ${tiket.email} subjek="${subject}" lampiran=${pdf.length} byte`,
      );
      return;
    }
    await this.transporter.sendMail({
      from: this.from ?? this.host,
      to: tiket.email,
      subject,
      text:
        `Halo ${tiket.nama},\n\nPembayaran tiket IGATE (${merchantRef}) sudah kami terima. ` +
        'QR tiketmu terlampir dalam PDF — tunjukkan ke petugas saat check-in.\n\nSalam,\nPanitia IGATE',
      attachments: [
        { filename: `${merchantRef}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    });
  }
}
