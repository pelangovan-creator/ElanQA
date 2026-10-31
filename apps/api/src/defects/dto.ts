import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DEFECT_STATUSES, DEFECT_TYPES, PRIORITIES, SEVERITIES } from '../common/enums';

export class DefectDto {
  @IsOptional() @IsString() @MinLength(5) @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(200) module?: string | null;
  @IsOptional() @IsString() @MaxLength(500) requirementId?: string | null;
  @IsOptional() @IsString() testCaseId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) environment?: string | null;
  @IsOptional() @IsString() @MaxLength(100) build?: string | null;
  @IsOptional() @IsString() @MaxLength(300) browserDeviceOs?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) preconditions?: string | null;
  @IsOptional() @IsString() @MaxLength(10000) stepsToReproduce?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) testDataUsed?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) expectedResult?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) actualResult?: string | null;
  @IsOptional() @IsIn(SEVERITIES) severity?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(DEFECT_TYPES) defectType?: string;
  @IsOptional() @IsString() @MaxLength(200) assignedTo?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) rootCause?: string | null;
  @IsOptional() @IsString() @MaxLength(100) fixVersion?: string | null;
  @IsOptional() @IsDateString() targetDate?: string | null;
}
export class CreateDefectDto extends DefectDto {
  @IsString() @MinLength(5) @MaxLength(250) declare title: string;
}
export class TransitionDto {
  @IsIn(DEFECT_STATUSES) to: string;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @IsOptional() @IsString() @MaxLength(200) assignedTo?: string;
  @IsOptional() @IsString() duplicateOfId?: string;
  @IsOptional() @IsString() @MaxLength(4000) rootCause?: string;
  @IsOptional() @IsString() @MaxLength(100) fixVersion?: string;
}
export class CommentDto { @IsString() @MinLength(1) @MaxLength(8000) text: string }
export class LinkDto { @IsString() targetId: string }
