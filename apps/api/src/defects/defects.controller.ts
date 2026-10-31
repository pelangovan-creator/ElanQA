import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from '../common/export/export.service';
import { DefectsService } from './defects.service';
import { DefectsExportService } from './defects-export';
import { JiraGuideService } from './jira-guide.service';
import { CommentDto, CreateDefectDto, DefectDto, LinkDto, TransitionDto } from './dto';
import { PRIORITY_DEFINITIONS, SEVERITY_DEFINITIONS, LIFECYCLE, STATUS_LABEL } from './lifecycle';

@Controller('projects/:projectId/defects')
export class DefectsController {
  constructor(private readonly defects: DefectsService, private readonly exp: DefectsExportService, private readonly exporter: ExportService, private readonly guide: JiraGuideService) {}

  // ── Manual Jira guide (no Jira connection): steps, illustrated screens, evidence ZIP
  @Get(':id/jira-guide') @RequirePermission('project.view')
  jiraGuide(@Param('projectId') p: string, @Param('id') id: string) { return this.guide.guide(p, id); }

  @Get(':id/jira-guide/steps/:no.png') @RequirePermission('project.view')
  async jiraStep(@Param('projectId') p: string, @Param('id') id: string, @Param('no') no: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(await this.guide.image(p, id, Number(no)));
  }

  @Get(':id/jira-guide/export') @RequirePermission('project.view')
  async jiraGuideExport(@Param('projectId') p: string, @Param('id') id: string, @Query('format') f: string, @Res() res: Response) {
    const doc = await this.guide.exportDoc(p, id);
    await this.exporter.send(res, doc, f || 'pdf', `${doc.meta![0][1]}-Jira-guide`);
  }

  @Get(':id/evidence.zip') @RequirePermission('project.view')
  async evidence(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const z = await this.guide.evidenceZip(p, id, u);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${z.fileName}"`);
    res.send(z.data);
  }

  @Get('meta') @RequirePermission('project.view')
  meta() { return { severity: SEVERITY_DEFINITIONS, priority: PRIORITY_DEFINITIONS, lifecycle: LIFECYCLE, statusLabel: STATUS_LABEL }; }

  @Get() @RequirePermission('project.view')
  list(@Param('projectId') p: string, @Query() q: Record<string, string>) { return this.defects.list(p, q); }

  @Get('export') @RequirePermission('project.view')
  async exportList(@Param('projectId') p: string, @Query('format') f: string, @Res() res: Response) { await this.exporter.send(res, await this.exp.list(p), f, 'Defect-List'); }

  @Post() @RequirePermission('defects.create')
  create(@Param('projectId') p: string, @Body() dto: CreateDefectDto, @CurrentUser() u: AuthUser) { return this.defects.create(p, dto, u); }

  @Post('from-run/:runId') @RequirePermission('defects.create')
  fromRun(@Param('projectId') p: string, @Param('runId') r: string, @CurrentUser() u: AuthUser) { return this.defects.processRun(p, r, u); }

  @Get(':id') @RequirePermission('project.view')
  get(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.defects.get(p, id, u); }

  @Get(':id/export') @RequirePermission('project.view')
  async exportOne(@Param('projectId') p: string, @Param('id') id: string, @Query('format') f: string, @Res() res: Response) {
    const doc = await this.exp.single(p, id);
    await this.exporter.send(res, doc, f, doc.title.split(':')[0]);
  }

  @Patch(':id') @RequirePermission('defects.update')
  update(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: DefectDto, @CurrentUser() u: AuthUser) { return this.defects.update(p, id, dto, u); }

  @Post(':id/transition') @RequirePermission('defects.update')
  transition(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: TransitionDto, @CurrentUser() u: AuthUser) { return this.defects.transition(p, id, dto, u); }

  @Post(':id/comments') @RequirePermission('defects.update')
  comment(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser) { return this.defects.comment(p, id, dto.text, u); }

  @Post(':id/attachments') @RequirePermission('defects.update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  upload(@Param('projectId') p: string, @Param('id') id: string, @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, @CurrentUser() u: AuthUser) {
    return this.defects.addAttachment(p, id, file, u);
  }

  @Post(':id/confirm') @RequirePermission('defects.create')
  confirm(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.defects.confirmDraft(p, id, u); }

  @Post(':id/link') @RequirePermission('defects.create')
  link(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: LinkDto, @CurrentUser() u: AuthUser) { return this.defects.linkDraft(p, id, dto.targetId, u); }

  @Delete(':id') @RequirePermission('defects.create')
  discard(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.defects.discardDraft(p, id, u); }
}
