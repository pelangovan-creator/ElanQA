import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { fileHeaders } from '../common/file-type';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { REQUIREMENT_CATEGORIES } from '../common/enums';
import { toCsv, toXlsx } from '../common/export.util';
import { MAX_UPLOAD_BYTES, RequirementsService, UploadedFile as File } from './requirements.service';

class UploadMetaDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() docType?: string;
}
class UpdateItemDto {
  @IsOptional() @IsIn(REQUIREMENT_CATEGORIES) category?: string;
  @IsOptional() @IsIn(['performance', 'security', 'usability', 'accessibility', 'compatibility', 'localization', 'reliability', null]) subCategory?: string | null;
}
class CoverageDto {
  @IsIn(['Informational', 'Acknowledged', 'Unmapped']) status: 'Informational' | 'Acknowledged' | 'Unmapped';
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

const upload = FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const RTM_COLUMNS = [
  { header: 'Requirement ID', key: 'reqId', width: 16 }, { header: 'Document', key: 'document', width: 10 }, { header: 'Section', key: 'section', width: 9 },
  { header: 'Page', key: 'page', width: 6 }, { header: 'Kind', key: 'sourceKind', width: 11 }, { header: 'Category', key: 'category', width: 14 },
  { header: 'Requirement Text', key: 'text', width: 60 }, { header: 'Coverage', key: 'coverageStatus', width: 13 }, { header: 'No-test reason', key: 'noTestReason', width: 30 },
  { header: 'Scenario IDs', key: 'scenarioIds', width: 18 }, { header: 'Test Case IDs', key: 'testCaseIds', width: 20 },
  { header: 'Execution Status', key: 'executionStatus', width: 14 }, { header: 'Defect IDs', key: 'defectIds', width: 18 },
];

@Controller('projects/:projectId/requirements')
export class RequirementsController {
  constructor(private readonly reqs: RequirementsService) {}

  @Post('documents')
  @RequirePermission('requirements.edit')
  @UseInterceptors(upload)
  uploadDocument(@Param('projectId') projectId: string, @UploadedFile() file: File, @Body() meta: UploadMetaDto, @CurrentUser() user: AuthUser) {
    return this.reqs.upload(projectId, user, file, meta);
  }

  @Post('documents/:documentId/versions')
  @RequirePermission('requirements.edit')
  @UseInterceptors(upload)
  uploadVersion(@Param('projectId') projectId: string, @Param('documentId') documentId: string, @UploadedFile() file: File, @CurrentUser() user: AuthUser) {
    return this.reqs.upload(projectId, user, file, {}, documentId);
  }

  @Get('documents')
  @RequirePermission('project.view')
  documents(@Param('projectId') projectId: string) {
    return this.reqs.listDocuments(projectId);
  }

  @Get('versions/:versionId')
  @RequirePermission('project.view')
  version(@Param('projectId') projectId: string, @Param('versionId') versionId: string) {
    return this.reqs.getVersion(projectId, versionId);
  }

  @Get('versions/:versionId/original')
  @RequirePermission('project.view')
  async original(@Param('projectId') projectId: string, @Param('versionId') versionId: string, @Res() res: Response) {
    const f = await this.reqs.original(projectId, versionId);
    // Always a download, never rendered: the stored type is only what the uploader's browser claimed.
    res.set({ ...fileHeaders(f.mimeType, f.data, f.fileName), 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.fileName)}"` });
    res.send(f.data);
  }

  @Get('items')
  @RequirePermission('project.view')
  items(@Param('projectId') projectId: string, @Query() q: Record<string, string>) {
    return this.reqs.listItems(projectId, q);
  }

  @Patch('items/:itemId')
  @RequirePermission('requirements.edit')
  updateItem(@Param('projectId') projectId: string, @Param('itemId') itemId: string, @Body() dto: UpdateItemDto, @CurrentUser() user: AuthUser) {
    return this.reqs.updateItem(projectId, itemId, dto, user);
  }

  @Post('items/:itemId/coverage')
  @RequirePermission('requirements.edit')
  setCoverage(@Param('projectId') projectId: string, @Param('itemId') itemId: string, @Body() dto: CoverageDto, @CurrentUser() user: AuthUser) {
    return this.reqs.setCoverage(projectId, itemId, dto, user);
  }

  @Get('coverage')
  @RequirePermission('project.view')
  coverage(@Param('projectId') projectId: string) {
    return this.reqs.coverageSummary(projectId);
  }

  @Post('coverage/accept-suggestions')
  @RequirePermission('requirements.edit')
  acceptSuggestions(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.reqs.acceptSuggestions(projectId, user);
  }

  @Get('rtm')
  @RequirePermission('project.view')
  rtm(@Param('projectId') projectId: string) {
    return this.reqs.rtm(projectId);
  }

  @Get('rtm/export')
  @RequirePermission('project.view')
  async rtmExport(@Param('projectId') projectId: string, @Query('format') format: string, @Res() res: Response) {
    const rows = await this.reqs.rtm(projectId);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="RTM-${stamp}.csv"`);
      return res.send(toCsv(RTM_COLUMNS, rows));
    }
    const buf = await toXlsx([{ name: 'RTM', columns: RTM_COLUMNS, rows, highlight: (r) => (r.coverageStatus === 'Unmapped' ? 'red' : r.executionStatus === 'Fail' ? 'amber' : undefined) }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="RTM-${stamp}.xlsx"`);
    res.send(buf);
  }

  @Get('questions')
  @RequirePermission('project.view')
  questions(@Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.reqs.questions(projectId, status);
  }
}
