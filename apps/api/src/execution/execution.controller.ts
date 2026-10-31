import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { fileHeaders } from '../common/file-type';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { EnvironmentsService } from './environments.service';
import { RunsService } from './runs.service';
import { ScriptService } from './scripts/script.service';
import { EnvironmentDto, GenerateScriptsDto, ManualResultDto, ScriptDto, StartManualDto, StartRunDto } from './dto';

@Controller('projects/:projectId/execution')
export class ExecutionController {
  constructor(private readonly envs: EnvironmentsService, private readonly scripts: ScriptService, private readonly runs: RunsService) {}

  // ── Environments (credentials are write-only; responses mask them)
  @Get('environments') @RequirePermission('project.view')
  listEnv(@Param('projectId') p: string) { return this.envs.list(p); }
  @Post('environments') @RequirePermission('execution.run')
  createEnv(@Param('projectId') p: string, @Body() dto: EnvironmentDto, @CurrentUser() u: AuthUser) { return this.envs.create(p, dto, u); }
  @Patch('environments/:id') @RequirePermission('execution.run')
  updateEnv(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: EnvironmentDto, @CurrentUser() u: AuthUser) { return this.envs.update(p, id, dto, u); }
  @Delete('environments/:id') @RequirePermission('execution.run')
  deleteEnv(@Param('projectId') p: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.envs.remove(p, id, u); }

  // ── Scripts
  @Post('scripts/generate') @RequirePermission('execution.run')
  generate(@Param('projectId') p: string, @Body() dto: GenerateScriptsDto, @CurrentUser() u: AuthUser) { return this.scripts.generate(p, u, dto); }
  @Get('scripts') @RequirePermission('project.view')
  listScripts(@Param('projectId') p: string) { return this.scripts.list(p); }
  @Get('scripts/:id') @RequirePermission('project.view')
  getScript(@Param('projectId') p: string, @Param('id') id: string) { return this.scripts.get(p, id); }
  @Patch('scripts/:id') @RequirePermission('execution.run')
  updateScript(@Param('projectId') p: string, @Param('id') id: string, @Body() dto: ScriptDto, @CurrentUser() u: AuthUser) { return this.scripts.update(p, id, dto.content, u); }

  // ── Runs
  @Post('runs') @RequirePermission('execution.run')
  start(@Param('projectId') p: string, @Body() dto: StartRunDto, @CurrentUser() u: AuthUser) { return this.runs.start(p, dto, u); }
  @Post('runs/preview') @RequirePermission('project.view')
  async preview(@Param('projectId') p: string, @Body() dto: StartManualDto) {
    const tcs = await this.runs.select(p, { mode: dto.mode ?? 'All', testCaseIds: dto.testCaseIds, module: dto.module, priority: dto.priority });
    return { total: tcs.length, automated: tcs.filter((t) => t.automatedScriptId).length, testCases: tcs };
  }
  @Get('runs') @RequirePermission('project.view')
  list(@Param('projectId') p: string) { return this.runs.list(p); }
  @Get('runs/:runId') @RequirePermission('project.view')
  get(@Param('projectId') p: string, @Param('runId') id: string) { return this.runs.get(p, id); }
  @Post('runs/:runId/abort') @RequirePermission('execution.run')
  abort(@Param('projectId') p: string, @Param('runId') id: string, @CurrentUser() u: AuthUser) { return this.runs.abort(p, id, u); }

  // ── Manual execution
  @Post('manual-runs') @RequirePermission('execution.run')
  startManual(@Param('projectId') p: string, @Body() dto: StartManualDto, @CurrentUser() u: AuthUser) { return this.runs.startManual(p, dto, u); }
  @Post('manual-runs/:runId/results') @RequirePermission('execution.run')
  record(@Param('projectId') p: string, @Param('runId') id: string, @Body() dto: ManualResultDto, @CurrentUser() u: AuthUser) { return this.runs.recordManual(p, id, dto, u); }
  @Post('manual-runs/:runId/results/:resultId/attachments') @RequirePermission('execution.run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Param('projectId') p: string, @Param('runId') id: string, @Param('resultId') rid: string, @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, @CurrentUser() u: AuthUser) {
    return this.runs.addManualAttachment(p, id, rid, file, u);
  }
  @Post('manual-runs/:runId/complete') @RequirePermission('execution.run')
  complete(@Param('projectId') p: string, @Param('runId') id: string, @CurrentUser() u: AuthUser) { return this.runs.completeManual(p, id, u); }

  // ── Evidence
  @Get('attachments/:id') @RequirePermission('project.view')
  async attachment(@Param('projectId') p: string, @Param('id') id: string, @Res() res: Response) {
    const a = await this.runs.attachment(p, id);
    res.set(fileHeaders(a.mimeType, a.data, a.fileName));
    res.send(a.data);
  }
}
