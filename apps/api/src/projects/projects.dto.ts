import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PROJECT_STATUSES, ROLES } from '../common/enums';

export class CreateProjectDto {
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: 'key must be 2-10 upper-case letters/digits, starting with a letter' })
  key: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() client?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() client?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class AddMemberDto {
  @IsString() userId: string;
  @IsIn(ROLES) role: string;
}

export class SettingDto {
  @Matches(/^[a-zA-Z0-9_.-]{1,64}$/) key: string;
  @IsString() value: string;
  @IsOptional() encrypted?: boolean;
}

export class RestoreProjectDto {
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: 'key must be 2-10 upper-case letters/digits, starting with a letter' })
  key: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
