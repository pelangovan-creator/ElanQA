import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PRIORITY_LEVELS, SCENARIO_TYPES, SEVERITIES, SUITES, TECHNIQUES, TEST_TYPES } from '../common/enums';
import { REVIEWABLE } from './review.service';
import { Q_CATEGORIES, Q_STATUSES } from './clarifications.service';

export class ReviewDto {
  @IsIn(REVIEWABLE) entityType: (typeof REVIEWABLE)[number];
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(2000) ids: string[];
  @IsIn(['Approve', 'Reject']) action: 'Approve' | 'Reject';
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class QuestionDto {
  @IsOptional() @IsString() requirementId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) sectionPage?: string | null;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(4000) question?: string;
  @IsOptional() @IsIn(Q_CATEGORIES) category?: string;
  @IsOptional() @IsString() @MaxLength(200) assignedTo?: string | null;
  @IsOptional() @IsIn(PRIORITY_LEVELS) priority?: string;
  @IsOptional() @IsIn(Q_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(8000) clientAnswer?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) impact?: string | null;
}
export class CreateQuestionDto extends QuestionDto {
  @IsString() @MinLength(5) @MaxLength(4000) declare question: string;
}

export class GenerateDto {
  @IsOptional() @IsIn(['unmapped', 'all', 'items']) scope?: 'unmapped' | 'all' | 'items';
  @IsOptional() @IsArray() @IsString({ each: true }) itemIds?: string[];
}
export class RegenerateDto {
  @IsOptional() @IsArray() @IsString({ each: true }) testCaseIds?: string[];
}

export class ScenarioDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) module?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(SCENARIO_TYPES) scenarioType?: string;
  @IsOptional() @IsIn(PRIORITY_LEVELS) priority?: string;
  @IsOptional() @IsString() @MaxLength(4000) preconditions?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) requirementIds?: string[];
}
export class CreateScenarioDto extends ScenarioDto {
  @IsString() @MinLength(1) declare module: string;
  @IsString() @MinLength(3) declare description: string;
}

export class StepDto {
  @IsOptional() no?: number; // ignored - steps are renumbered on save
  @IsString() @MaxLength(4000) action: string;
  @IsString() @MaxLength(4000) expected: string;
}
export class TestCaseDto {
  @IsOptional() @IsString() scenarioId?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) module?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(8000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) preconditions?: string | null;
  @IsOptional() @IsString() @MaxLength(50) testDataRef?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StepDto) steps?: StepDto[];
  @IsOptional() @IsIn(PRIORITY_LEVELS) priority?: string;
  @IsOptional() @IsIn([...SEVERITIES, null]) severityIfFailed?: string | null;
  @IsOptional() @IsIn(TEST_TYPES) testType?: string;
  @IsOptional() @IsIn(TECHNIQUES) technique?: string;
  @IsOptional() @IsBoolean() automationCandidate?: boolean;
  @IsOptional() @IsArray() @IsIn(SUITES, { each: true }) suites?: string[];
  @IsOptional() @IsString() @MaxLength(4000) comments?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) requirementIds?: string[];
  @IsOptional() @IsBoolean() clearRegeneration?: boolean;
}
export class CreateTestCaseDto extends TestCaseDto {
  @IsString() @MinLength(1) declare module: string;
  @IsString() @MinLength(3) declare title: string;
}

export class TestDataDto {
  @IsOptional() @IsString() @MaxLength(200) fieldName?: string;
  @IsOptional() @IsString() @MaxLength(50) dataType?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tcIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) validValues?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) invalidValues?: string[];
  @IsOptional() @IsObject() boundaryValues?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(2000) specialChars?: string;
  @IsOptional() @IsString() @MaxLength(2000) emptyNull?: string;
  @IsOptional() @IsString() @MaxLength(4000) expectedBehaviour?: string;
  @IsOptional() @IsString() @MaxLength(50) environment?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class SectionDto {
  @IsString() @MaxLength(50000) body: string;
}
