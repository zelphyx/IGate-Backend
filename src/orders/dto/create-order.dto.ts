import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

export class CreateOrderDto {
  @ApiProperty({ example: 'Budi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nama!: string;

  @ApiProperty({ example: '2406012123001', description: 'NIM 10–20 digit angka (disetujui panitia)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,20}$/, { message: 'nim harus 10–20 digit angka.' })
  @MaxLength(20)
  nim!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  nomorHp!: string;

  @ApiProperty({ example: 'budi@mail.id' })
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @ApiPropertyOptional({
    example: 2026,
    description: 'Opsional — tahun angkatan (2000–2100). Default: diambil dari 2 digit awal NIM.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  angkatan?: number;

  @ApiPropertyOptional({ example: 'IGATE-ABCD-1234', description: 'Opsional — voucher diskon' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kodeVoucher?: string;
}
