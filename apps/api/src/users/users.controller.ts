import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('users.manage')
  list() {
    return this.users.list();
  }

  /** Minimal directory (id, name, role) used for assignee pickers by any signed-in user. */
  @Get('directory')
  directory() {
    return this.prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
  }

  @Post()
  @RequirePermission('users.manage')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.create(dto, actor.id);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(id, dto, actor.id);
  }
}
