import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BackupService } from './backup.service';
import type { Response } from 'express';
import { ProjectsService } from './projects.service';
import { AddMemberDto, CreateProjectDto, RestoreProjectDto, SettingDto, UpdateProjectDto } from './projects.dto';

/** Largest backup upload accepted (compressed), default 1 GB. */
const MAX_BACKUP_UPLOAD = Number(process.env.BACKUP_UPLOAD_MAX_MB ?? 1024) * 1024 * 1024;
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly backup: BackupService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.listFor(user);
  }

  @Post()
  @RequirePermission('project.create')
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.projects.create(dto, user);
  }

  @Get(':projectId')
  @RequirePermission('project.view')
  async get(@Param('projectId') id: string, @CurrentUser() user: AuthUser) {
    const project = await this.projects.get(id);
    return { ...project, myRole: user.projectRole, permissions: this.projects.permissionsFor(user.projectRole!) };
  }

  @Patch(':projectId')
  @RequirePermission('project.manage')
  update(@Param('projectId') id: string, @Body() dto: UpdateProjectDto, @CurrentUser() user: AuthUser) {
    return this.projects.update(id, dto, user);
  }

  @Post(':projectId/members')
  @RequirePermission('project.manage')
  addMember(@Param('projectId') id: string, @Body() dto: AddMemberDto, @CurrentUser() user: AuthUser) {
    return this.projects.addMember(id, dto, user);
  }

  @Delete(':projectId/members/:userId')
  @RequirePermission('project.manage')
  removeMember(@Param('projectId') id: string, @Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.projects.removeMember(id, userId, user);
  }

  @Get(':projectId/settings')
  @RequirePermission('project.manage')
  settings(@Param('projectId') id: string) {
    return this.projects.listSettings(id);
  }

  @Put(':projectId/settings')
  @RequirePermission('project.manage')
  setSetting(@Param('projectId') id: string, @Body() dto: SettingDto, @CurrentUser() user: AuthUser) {
    return this.projects.setSetting(id, dto, user);
  }

  /** Full project backup: ZIP with every table and every stored file. */
  @Get(':projectId/export')
  @RequirePermission('project.export')
  async export(@Param('projectId') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const out = await this.backup.exportZip(id, user);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    out.stream.pipe(res);
  }

  /** Restores a backup ZIP as a new project with the given key. */
  @Post('restore')
  @RequirePermission('project.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BACKUP_UPLOAD, files: 1 } }))
  restore(@UploadedFile() file: { buffer: Buffer } | undefined, @Body() dto: RestoreProjectDto, @CurrentUser() user: AuthUser) {
    return this.backup.restore(file?.buffer as Buffer, dto, user);
  }
}
