import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from '../common/export/export.service';
import { ClarificationsService } from './clarifications.service';
import { DesignService } from './design/design.service';
import { DocsService, DocType } from './docs.service';
import { ReviewService } from './review.service';
import {
  CreateQuestionDto, CreateScenarioDto, CreateTestCaseDto, GenerateDto, QuestionDto, RegenerateDto, ReviewDto, ScenarioDto, SectionDto, TestCaseDto, TestDataDto,
} from './dto';

enum DocTypeParam { TestPlan = 'TestPlan', TestTechniques = 'TestTechniques' }

@Controller('projects/:projectId/artefacts')
export class ArtefactsController {
  constructor(
    private readonly review: ReviewService,
    private readonly questions: ClarificationsService,
    private readonly design: DesignService,
    private readonly docs: DocsService,
    private readonly exporter: ExportService,
  ) {}

  // ── Review workflow
  @Post('review') @RequirePermission('artefacts.review')
  doReview(@Param('projectId') p: string, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser) { return this.review.review(p, dto.entityType, dto.ids, dto.action, dto.comment, u); }

  @Get('review/:entityType/:id') @RequirePermission('project.view')
  reviewHistory(@Param('projectId') p: string, @Param('entityType') t: string, @Param('id') id: string) { return this.review.history(p, t, id); }

  // ── Clarification log
  @Get('clarifications') @RequirePermission('project.view')
  listQ(@Param('projectId') p: string, @Query() q: Record<string, string>) { return this.questions.list(p, q); }

  @Post('clarifications') @RequirePermission('artefacts.edit')
  createQ(@Param('projectId') p: string, @Body() dto: CreateQuestionDto, @CurrentUser() u: AuthUser) { return this.questions.create(p, dto, u); }

  @Patch('clarifications/:id') @RequirePermission('artefacts.edit')
  updateQ(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: QuestionDto, @CurrentUser() u: AuthUser) { return this.questions.update(p, id, dto, u); }

  @Delete('clarifications/:id') @RequirePermission('artefacts.edit')
  deleteQ(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.questions.remove(p, id, u); }

  @Post('clarifications/detect') @RequirePermission('artefacts.edit')
  detect(@Param('projectId') p: string, @CurrentUser() u: AuthUser) { return this.questions.detect(p, u); }

  @Get('clarifications/export') @RequirePermission('project.view')
  async exportQ(@Param('projectId') p: string, @Query('format') f: string, @Res() res: Response) { await this.exporter.send(res, await this.questions.exportDoc(p), f, 'Clarification-Log'); }

  // ── Generation
  @Post('design/generate') @RequirePermission('artefacts.edit')
  generate(@Param('projectId') p: string, @Body() dto: GenerateDto, @CurrentUser() u: AuthUser) { return this.design.generate(p, u, dto); }

  @Post('design/regenerate') @RequirePermission('artefacts.edit')
  regenerate(@Param('projectId') p: string, @Body() dto: RegenerateDto, @CurrentUser() u: AuthUser) { return this.design.regenerate(p, u, dto.testCaseIds); }

  // ── Scenarios
  @Get('scenarios') @RequirePermission('project.view')
  listS(@Param('projectId') p: string) { return this.design.listScenarios(p); }

  @Post('scenarios') @RequirePermission('artefacts.edit')
  createS(@Param('projectId') p: string, @Body() dto: CreateScenarioDto, @CurrentUser() u: AuthUser) { return this.design.createScenario(p, dto, u); }

  @Patch('scenarios/:id') @RequirePermission('artefacts.edit')
  updateS(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: ScenarioDto, @CurrentUser() u: AuthUser) { return this.design.updateScenario(p, id, dto, u); }

  @Delete('scenarios/:id') @RequirePermission('artefacts.edit')
  deleteS(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.design.deleteScenario(p, id, u); }

  @Get('scenarios/export') @RequirePermission('project.view')
  async exportS(@Param('projectId') p: string, @Query('format') f: string, @Res() res: Response) { await this.exporter.send(res, await this.design.scenariosDoc(p), f, 'Test-Scenarios'); }

  // ── Test cases
  @Get('test-cases') @RequirePermission('project.view')
  listTC(@Param('projectId') p: string, @Query() q: Record<string, string>) { return this.design.listTestCases(p, q); }

  @Get('test-cases/export') @RequirePermission('project.view')
  async exportTC(@Param('projectId') p: string, @Query('format') f: string, @Res() res: Response) { await this.exporter.send(res, await this.design.testCasesDoc(p), f, 'Test-Cases'); }

  @Get('test-cases/:id') @RequirePermission('project.view')
  getTC(@Param('projectId') p: string, @Param('id') id: string) { return this.design.getTestCase(p, id); }

  @Post('test-cases') @RequirePermission('artefacts.edit')
  createTC(@Param('projectId') p: string, @Body() dto: CreateTestCaseDto, @CurrentUser() u: AuthUser) { return this.design.createTestCase(p, dto, u); }

  @Patch('test-cases/:id') @RequirePermission('artefacts.edit')
  updateTC(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: TestCaseDto, @CurrentUser() u: AuthUser) { return this.design.updateTestCase(p, id, dto, u); }

  @Delete('test-cases/:id') @RequirePermission('artefacts.edit')
  deleteTC(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.design.deleteTestCase(p, id, u); }

  // ── Test data
  @Get('test-data') @RequirePermission('project.view')
  listTD(@Param('projectId') p: string) { return this.design.listTestData(p); }

  @Get('test-data/export') @RequirePermission('project.view')
  async exportTD(@Param('projectId') p: string, @Query('format') f: string, @Res() res: Response) { await this.exporter.send(res, await this.design.testDataDoc(p), f, 'Test-Data-Sheet'); }

  @Post('test-data') @RequirePermission('artefacts.edit')
  createTD(@Param('projectId') p: string, @Body() dto: TestDataDto, @CurrentUser() u: AuthUser) { return this.design.upsertTestData(p, null, dto, u); }

  @Patch('test-data/:id') @RequirePermission('artefacts.edit')
  updateTD(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: TestDataDto, @CurrentUser() u: AuthUser) { return this.design.upsertTestData(p, id, dto, u); }

  @Delete('test-data/:id') @RequirePermission('artefacts.edit')
  deleteTD(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.design.deleteTestData(p, id, u); }

  // ── Test Plan & Techniques document
  @Get('docs/:type') @RequirePermission('project.view')
  getDoc(@Param('projectId') p: string, @Param('type', new ParseEnumPipe(DocTypeParam)) t: DocType) { return this.docs.get(p, t); }

  @Post('docs/:type/generate') @RequirePermission('artefacts.edit')
  genDoc(@Param('projectId') p: string, @Param('type', new ParseEnumPipe(DocTypeParam)) t: DocType, @CurrentUser() u: AuthUser) { return this.docs.generate(p, t, u); }

  @Patch('docs/:type/sections/:key') @RequirePermission('artefacts.edit')
  updateDoc(@Param('projectId') p: string, @Param('type', new ParseEnumPipe(DocTypeParam)) t: DocType, @Param('key') k: string, @Body() dto: SectionDto, @CurrentUser() u: AuthUser) {
    return this.docs.updateSection(p, t, k, dto.body, u);
  }

  @Get('docs/:type/export') @RequirePermission('project.view')
  async exportDoc(@Param('projectId') p: string, @Param('type', new ParseEnumPipe(DocTypeParam)) t: DocType, @Query('format') f: string, @Res() res: Response) {
    await this.exporter.send(res, await this.docs.exportDoc(p, t), f, t === 'TestPlan' ? 'Test-Plan' : 'Test-Techniques');
  }
}
