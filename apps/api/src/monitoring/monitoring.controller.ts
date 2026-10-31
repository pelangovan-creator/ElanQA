import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from '../common/export/export.service';
import { MonitoringService } from './monitoring.service';

class SlaDto {
  @IsOptional() @IsNumber() @Min(1) @Max(8760) P1?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(8760) P2?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(8760) P3?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(8760) P4?: number;
}
class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() timeZone?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) morning?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) evening?: string;
  @IsOptional() @ValidateNested() @Type(() => SlaDto) slaHours?: SlaDto;
  @IsOptional() @IsInt() @Min(1) @Max(90) agingDays?: number;
}

@Controller('projects/:projectId/monitoring')
export class MonitoringController {
  constructor(private readonly monitor: MonitoringService, private readonly exporter: ExportService) {}

  @Get('settings') @RequirePermission('project.view')
  settings(@Param('projectId') p: string) { return this.monitor.settings(p); }

  @Put('settings') @RequirePermission('project.manage')
  save(@Param('projectId') p: string, @Body() dto: SettingsDto, @CurrentUser() u: AuthUser) { return this.monitor.saveSettings(p, dto as never, u); }

  @Post('run') @RequirePermission('project.manage')
  run(@Param('projectId') p: string, @CurrentUser() u: AuthUser) { return this.monitor.runCheck(p, 'Manual', { user: u }); }

  @Get('checks') @RequirePermission('project.view')
  list(@Param('projectId') p: string, @Query('take') take?: string) { return this.monitor.list(p, Math.min(Number(take) || 60, 500)); }

  @Get('checks/:id') @RequirePermission('project.view')
  get(@Param('projectId') p: string, @Param('id') id: string) { return this.monitor.get(p, id); }

  @Get('checks/:id/export') @RequirePermission('project.view')
  async export(@Param('projectId') p: string, @Param('id') id: string, @Query('format') f: string, @Res() res: Response) {
    await this.exporter.send(res, await this.monitor.exportDoc(p, id), f, 'Defect-Alert-Summary');
  }
}
