import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { BROWSERS } from './environments.service';
import { RUN_MODES } from './runs.service';

export class EnvironmentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsIn(['QA', 'UAT', 'Staging', 'Dev', 'Production']) envType?: string;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) baseUrl?: string;
  @IsOptional() @IsArray() @IsIn(BROWSERS, { each: true }) browsers?: string[];
  @IsOptional() @Matches(/^\d{3,4}x\d{3,4}$/) viewport?: string;
  @IsOptional() @IsObject() modulePaths?: Record<string, string>;
  @IsOptional() @IsInt() @Min(1) @Max(16) workers?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3) retries?: number;
  @IsOptional() @IsInt() @Min(5000) @Max(300000) timeoutMs?: number;
  @IsOptional() @IsObject() credentials?: Record<string, { username: string; password: string }>;
}

export class GenerateScriptsDto {
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsBoolean() includePending?: boolean;
  @IsOptional() @IsBoolean() force?: boolean;
}
export class ScriptDto {
  @IsString() @MaxLength(500_000) content: string;
}

export class StartRunDto {
  @IsString() environmentId: string;
  @IsIn(RUN_MODES) mode: (typeof RUN_MODES)[number];
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) testCaseIds?: string[];
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsIn(['High', 'Medium', 'Low']) priority?: string;
  @IsOptional() @IsString() @MaxLength(100) build?: string;
  @IsOptional() @IsArray() @IsIn(BROWSERS, { each: true }) browsers?: string[];
}

export class StartManualDto {
  @IsOptional() @IsIn(RUN_MODES) mode?: (typeof RUN_MODES)[number];
  @IsOptional() @IsArray() @IsString({ each: true }) testCaseIds?: string[];
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsIn(['High', 'Medium', 'Low']) priority?: string;
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) build?: string;
}

export class ManualStepDto {
  @IsInt() no: number;
  @IsIn(['Pass', 'Fail', 'Blocked', 'Skipped', 'NotRun']) status: string;
  @IsOptional() @IsString() @MaxLength(4000) actual?: string;
}
export class ManualResultDto {
  @IsString() testCaseId: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManualStepDto) steps: ManualStepDto[];
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
