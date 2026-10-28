import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import { Tiket } from '@prisma/client';

/** Nama file PDF tiket: hanya boleh `{tiketId}.pdf` (path sanitasi, PLAN §T6). */
export const TICKET_PDF_NAME_PATTERN = /^[0-9]+\.pdf$/;

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly storageDir: string;

  constructor(config: ConfigService) {
    this.storageDir = path.resolve(config.get<string>('storageDir') ?? 'storage');
  }

  /** Rakit PDF A5 tiket (logo teks, identitas pembeli, QR besar). */
  buildTicketPdf(tiket: Tiket, qrPng: Buffer, merchantRef: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: merchantRef } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).font('Helvetica-Bold').text('TIKET IGATE', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(11).font('Helvetica').fillColor('#555555').text(merchantRef, { align: 'center' });
      doc.fillColor('#000000').moveDown(1);

      doc.fontSize(13).font('Helvetica-Bold').text(tiket.nama);
      doc.font('Helvetica').fontSize(11);
      doc.text(`NIM      : ${tiket.nim}`);
      doc.text(`Angkatan : ${tiket.angkatan}`);
      doc.text(`Nomor HP : ${tiket.nomorHp}`);
      doc.text(`Total    : Rp ${tiket.totalBayar.toString()}`);
      doc.moveDown(1);

      doc.image(qrPng, { fit: [220, 220], align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666666').text(
        'Tunjukkan QR ini ke petugas saat check-in. QR hanya berlaku untuk tiket yang sudah dibayar.',
        { align: 'center', width: 420 },
      );

      doc.end();
    });
  }

  /** Simpan PDF ke `storage/{tiketId}.pdf` (direktori dibuat bila belum ada). */
  async saveTicketPdf(tiketId: number, pdf: Buffer): Promise<string> {
    await fs.promises.mkdir(this.storageDir, { recursive: true });
    const filePath = path.join(this.storageDir, `${tiketId}.pdf`);
    await fs.promises.writeFile(filePath, pdf);
    this.logger.debug(`PDF tiket disimpan: ${filePath}`);
    return filePath;
  }

  /** Baca PDF tiket dari storage (path sudah tersanitasi lewat pola tiketId). */
  async readTicketPdf(tiketId: number): Promise<Buffer | null> {
    const fileName = `${tiketId}.pdf`;
    if (!TICKET_PDF_NAME_PATTERN.test(fileName)) return null; // pertahanan ganda
    try {
      return await fs.promises.readFile(path.join(this.storageDir, fileName));
    } catch {
      return null;
    }
  }
}
