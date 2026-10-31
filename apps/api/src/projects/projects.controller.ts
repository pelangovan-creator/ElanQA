import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from './projects.service';
import { AddMemberDto, CreateProjectDto, SettingDto, UpdateProjectDto } from './projects.dto';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

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

  @Get(':projectId/export')
  @RequirePermission('project.export')
  async export(@Param('projectId') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const data = await this.projects.exportProject(id, user);
    res.setHeader('Content-Disposition', `attachment; filename="qa-pilot-${data.project.key}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  }
}
