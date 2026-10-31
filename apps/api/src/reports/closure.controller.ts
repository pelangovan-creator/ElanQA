import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from '../common/export/export.service';
import { ClosureService, TRIGGERS, Trigger } from './closure.service';

class GenerateDto {
  @IsIn(TRIGGERS) trigger: Trigger;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional() @IsString() @MaxLength(100) release?: string;
}
class UpdateDto {
  @IsOptional() @IsObject() header?: Record<string, string>;
  @IsOptional() @IsObject() narrative?: Record<string, string>;
  @IsOptional() @IsArray() risks?: Record<string, string>[];
  @IsOptional() @IsObject() recommendation?: { decision?: string; reason?: string; conditions?: string };
  @IsOptional() @IsObject() exitComments?: Record<string, string>;
}
class StatusDto { @IsIn(['Draft', 'Final']) status: 'Draft' | 'Final' }
class SignDto {
  @IsIn(['QALead', 'PM', 'Client']) role: 'QALead' | 'PM' | 'Client';
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsIn(['Approved', 'ApprovedWithConditions', 'Rejected']) decision: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

@Controller('projects/:projectId/closure')
export class ClosureController {
  constructor(private readonly closure: ClosureService, private readonly exporter: ExportService) {}

  @Get('eligibility') @RequirePermission('project.view')
  eligibility(@Param('projectId') p: string) { return this.closure.eligibility(p); }

  @Get() @RequirePermission('project.view')
  list(@Param('projectId') p: string) { return this.closure.list(p); }

  @Post() @RequirePermission('closure.trigger')
  generate(@Param('projectId') p: string, @Body() dto: GenerateDto, @CurrentUser() u: AuthUser) { return this.closure.generate(p, dto, u); }

  @Get(':id') @RequirePermission('project.view')
  get(@Param('projectId') p: string, @Param('id') id: string) { return this.closure.get(p, id); }

  @Patch(':id') @RequirePermission('closure.trigger')
  update(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: UpdateDto, @CurrentUser() u: AuthUser) { return this.closure.update(p, id, dto as never, u); }

  @Post(':id/refresh') @RequirePermission('closure.trigger')
  refresh(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.closure.refresh(p, id, u); }

  @Post(':id/status') @RequirePermission('closure.trigger')
  status(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: StatusDto, @CurrentUser() u: AuthUser) { return this.closure.setStatus(p, id, dto.status, u); }

  /** View permission only: the service lets a Client sign the Client section; recording other sections needs closure.trigger. */
  @Post(':id/sign') @RequirePermission('project.view')
  sign(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: SignDto, @CurrentUser() u: AuthUser) { return this.closure.sign(p, id, dto, u); }

  @Delete(':id') @RequirePermission('closure.trigger')
  remove(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.closure.remove(p, id, u); }

  @Get(':id/export') @RequirePermission('project.view')
  async export(@Param('projectId') p: string, @Param('id') id: string, @Query('format') f: string, @Res() res: Response) {
    if (f === 'eml') {
      const e = await this.closure.eml(p, id);
      res.setHeader('Content-Type', 'message/rfc822');
      res.setHeader('Content-Disposition', `attachment; filename="${e.fileName}"`);
      return res.send(e.data);
    }
    const doc = await this.closure.exportDoc(p, id);
    await this.exporter.send(res, doc, f, 'Test-Closure-Report');
  }
}
