import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}
