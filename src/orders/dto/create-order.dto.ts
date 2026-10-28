import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'Budi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nama!: string;

  @ApiProperty({ example: '2406012123001', description: 'Harus diawali 2406012 (BR-02)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
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

  @ApiPropertyOptional({ example: 'IGATE-ABCD-1234', description: 'Opsional — voucher diskon' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kodeVoucher?: string;
}
