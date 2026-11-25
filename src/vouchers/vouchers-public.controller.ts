import { Controller, Get, HttpCode, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { VouchersService } from './vouchers.service';

export interface VoucherCheckResult {
  /** true = kode valid & bisa dipakai (AKTIF, belum kadaluarsa). */
  valid: boolean;
  /** Nilai diskon (string Decimal) jika valid, null jika tidak. */
  nilai: string | null;
  /** Pesan untuk UI: alasan tidak valid, atau konfirmasi valid. */
  pesan: string;
}

/**
 * Endpoint publik cek kode voucher — untuk form pembelian tiket agar total
 * setelah diskon langsung terlihat (revisi frontend 2026-11, item 5).
 * Tidak membocorkan PII pemberi; cukup valid/nilai/pesan.
 */
@ApiTags('vouchers')
@Controller('vouchers')
export class VouchersPublicController {
  constructor(private readonly vouchers: VouchersService) {}

  @Public()
  @Get(':kode')
  @HttpCode(200)
  // Longgarkan ke 60/menit/IP agar tidak mudah 429 pada Wi-Fi kampus / CGNAT / live check
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'Cek validitas kode voucher (publik, tanpa auth)' })
  async check(@Param('kode') kode: string): Promise<VoucherCheckResult> {
    return this.vouchers.checkPublic(kode);
  }
}
