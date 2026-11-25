import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizePhoneInput = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s\-()]/g, '') : value;

const toOptionalNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return undefined;
  return Number(value);
};

export class CreateOrderDto {
  @ApiProperty({ example: 'Budi' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nama!: string;

  @ApiProperty({ example: '2406012123001', description: 'NIM 10–20 digit angka (disetujui panitia)' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,20}$/, { message: 'nim harus 10–20 digit angka.' })
  @MaxLength(20)
  nim!: string;

  @ApiProperty({ example: '081234567890' })
  @Transform(normalizePhoneInput)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  nomorHp!: string;

  @ApiProperty({ example: 'budi@mail.id' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @ApiPropertyOptional({
    example: 2026,
    description: 'Opsional — tahun angkatan (2000–2100). Default: diambil dari 2 digit awal NIM.',
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt()
  @Min(2000)
  @Max(2100)
  angkatan?: number;

  @ApiPropertyOptional({ example: 'IGATE-ABCD-1234', description: 'Opsional — voucher diskon' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(40)
  kodeVoucher?: string;

  @ApiPropertyOptional({
    example: '0.zo4...',
    description: 'Token Cloudflare Turnstile (wajib saat TURNSTILE_SECRET_KEY aktif di server).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
}
