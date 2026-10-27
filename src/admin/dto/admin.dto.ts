import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ROLES } from '../../common/constants';
import { Role } from '../../common/constants';

export class CreateAdminDto {
  @ApiProperty()
  @IsString()
  nama!: string;

  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  password!: string;

  @ApiProperty({ enum: Object.values(ROLES) })
  @IsString()
  role!: Role;
}

export class UpdateAdminDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nama?: string;

  @ApiProperty({ required: false, enum: Object.values(ROLES) })
  @IsOptional()
  @IsString()
  role?: Role;

  @ApiProperty({ required: false, minLength: 10, description: 'Reset password' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  password?: string;
}
