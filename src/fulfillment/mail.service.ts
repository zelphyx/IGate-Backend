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

  async sendTicketMail(tiket: Tiket, merchantRef: string, pdf: Buffer, qrPng: Buffer): Promise<void> {
    const subject = `Tiket IGATE ${tiket.kodeTiket} — pembayaran diterima`;
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
        `Halo ${tiket.nama},\n\nPembayaran tiket IGATE (${tiket.kodeTiket}) sudah kami terima. ` +
        'QR tiketmu terlampir dalam PDF — tunjukkan ke petugas saat check-in.\n\nSalam,\nPanitia IGATE',
      html: ticketEmailHtml(tiket),
      attachments: [
        // QR inline untuk <img src="cid:..."> — tampil di semua klien email modern
        { filename: 'qr-tiket.png', content: qrPng, cid: 'qr-tiket', contentType: 'image/png' },
        { filename: `${merchantRef}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    });
  }
}

/** Template HTML email tiket — tabel-based agar aman di klien email lama (Outlook dsb.). */
export function ticketEmailHtml(tiket: Pick<Tiket, 'nama' | 'nim' | 'kodeTiket'>): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const kodeTiket = tiket.kodeTiket;
  return `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">

            <!-- Header merah -->
            <tr>
              <td align="center" style="background-color:#c0392b;padding:32px 24px;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;">Pembayaran Berhasil!</h1>
                <p style="margin:12px 0 0;color:#ffe3e0;font-size:15px;">
                  Halo <strong>${esc(tiket.nama)}</strong>, ini tiket IGATE-mu.
                </p>
              </td>
            </tr>

            <!-- QR + kode unik -->
            <tr>
              <td align="center" style="padding:32px 24px 8px;">
                <p style="margin:0 0 16px;color:#2c3e50;font-size:17px;font-weight:bold;">QR Code Tiket</p>
                <img src="cid:qr-tiket" alt="QR Tiket ${esc(kodeTiket)}" width="220" height="220"
                     style="display:block;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#ffffff;" />
                <p style="margin:16px 0 0;color:#2c3e50;font-size:15px;">
                  Kode Tiket: <strong>${esc(kodeTiket)}</strong>
                </p>
              </td>
            </tr>

            <!-- Detail singkat -->
            <tr>
              <td style="padding:16px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;">
                  <tr>
                    <td style="padding:12px 0;color:#7f8c8d;font-size:13px;">Nama</td>
                    <td align="right" style="padding:12px 0;color:#2c3e50;font-size:13px;font-weight:bold;">${esc(tiket.nama)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 12px;color:#7f8c8d;font-size:13px;">NIM</td>
                    <td align="right" style="padding:0 0 12px;color:#2c3e50;font-size:13px;font-weight:bold;">${esc(tiket.nim)}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Petunjuk -->
            <tr>
              <td style="padding:8px 32px 0;">
                <div style="background-color:#f8f9fa;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0 0 8px;color:#c0392b;font-size:13px;font-weight:bold;">PENTING:</p>
                  <p style="margin:0;color:#555555;font-size:13px;line-height:20px;">
                    &bull; Simpan QR code ini (screenshot / simpan PDF terlampir)<br/>
                    &bull; Tunjukkan saat masuk ke venue<br/>
                    &bull; Jangan bagikan QR code ke orang lain
                  </p>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:24px 32px 32px;">
                <p style="margin:0;color:#7f8c8d;font-size:12px;">Ditunggu kedatangannya di <strong>IGATE</strong>!</p>
                <p style="margin:8px 0 0;color:#95a5a6;font-size:11px;">
                  Butuh bantuan? Hubungi <a href="mailto:igate.psdm@gmail.com" style="color:#c0392b;">igate.psdm@gmail.com</a>
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
