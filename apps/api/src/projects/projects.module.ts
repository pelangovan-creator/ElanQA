import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { BackupService } from './backup.service';

@Module({ controllers: [ProjectsController], providers: [ProjectsService, BackupService], exports: [ProjectsService] })
export class ProjectsModule {}
