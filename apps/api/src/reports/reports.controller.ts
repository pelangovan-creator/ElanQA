import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { IsDateString, IsIn, IsObject, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from '../common/export/export.service';
import { REPORT_TYPES, ReportsService, ReportType } from './reports.service';

class GenerateDto {
  @IsIn(REPORT_TYPES) type: ReportType;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
class UpdateDto {
  @IsOptional() @IsObject() header?: Record<string, string>;
  @IsOptional() @IsObject() narrative?: Record<string, string>;
}
class StatusDto { @IsIn(['Draft', 'Final', 'Sent']) status: 'Draft' | 'Final' | 'Sent' }

@Controller('projects/:projectId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly exporter: ExportService) {}

  @Get('dashboard') @RequirePermission('project.view')
  dashboard(@Param('projectId') p: string, @Query('days') days?: string) { return this.reports.dashboard(p, Number(days) || 14); }

  @Get() @RequirePermission('project.view')
  list(@Param('projectId') p: string, @Query('type') type?: string) { return this.reports.list(p, type); }

  @Post() @RequirePermission('reports.edit')
  generate(@Param('projectId') p: string, @Body() dto: GenerateDto, @CurrentUser() u: AuthUser) {
    const d = (s?: string) => s?.slice(0, 10);
    return this.reports.generate(p, dto.type, { date: d(dto.date), from: d(dto.from), to: d(dto.to) }, u);
  }

  @Get(':id') @RequirePermission('project.view')
  get(@Param('projectId') p: string, @Param('id') id: string) { return this.reports.get(p, id); }

  @Patch(':id') @RequirePermission('reports.edit')
  update(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: UpdateDto, @CurrentUser() u: AuthUser) { return this.reports.update(p, id, dto, u); }

  @Post(':id/refresh') @RequirePermission('reports.edit')
  refresh(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.reports.refresh(p, id, u); }

  @Post(':id/status') @RequirePermission('reports.edit')
  status(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: StatusDto, @CurrentUser() u: AuthUser) { return this.reports.setStatus(p, id, dto.status, u); }

  @Delete(':id') @RequirePermission('reports.edit')
  remove(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.reports.remove(p, id, u); }

  @Get(':id/export') @RequirePermission('project.view')
  async export(@Param('projectId') p: string, @Param('id') id: string, @Query('format') f: string, @Res() res: Response) {
    if (f === 'eml') {
      const e = await this.reports.eml(p, id);
      res.setHeader('Content-Type', 'message/rfc822');
      res.setHeader('Content-Disposition', `attachment; filename="${e.fileName}"`);
      return res.send(e.data);
    }
    const doc = await this.reports.exportDoc(p, id);
    const r = await this.reports.get(p, id);
    await this.exporter.send(res, doc, f, `${r.type}-${r.content.data.period.to}`);
  }
}
