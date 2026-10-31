import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ROLES } from '../common/enums';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) name: string;
  @IsIn(ROLES) role: string;
  @IsString() password: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(ROLES) role?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() password?: string;
}
