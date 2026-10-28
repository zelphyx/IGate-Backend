import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

/** Generator QR PNG (di-mock di unit test bila perlu). */
@Injectable()
export class QrService {
  toPngBuffer(payload: string): Promise<Buffer> {
    return QRCode.toBuffer(payload, {
      type: 'png',
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  }
}
