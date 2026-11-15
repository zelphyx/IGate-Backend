import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  namaPemberi!: string;

  /** NIM pemberi (mahasiswa) — 14 digit (keputusan panitia 2026-11). */
  @IsString()
  @Matches(/^\d{14}$/, { message: 'nim harus 14 digit.' })
  nim!: string;

  @IsString()
  @Matches(/^(?:\+62|62|0)8\d{7,12}$/, { message: 'nomorHp harus format 08xx / +62.' })
  nomorHp!: string;

  /** Nominal voucher dalam rupiah (BR-06: antara VOUCHER_MIN_NOMINAL & VOUCHER_MAX_NOMINAL). */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  nominal!: number;
}
