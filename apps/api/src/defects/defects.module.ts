import { Module } from '@nestjs/common';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';
import { DefectsExportService } from './defects-export';
import { JiraGuideService } from './jira-guide.service';

@Module({ controllers: [DefectsController], providers: [DefectsService, DefectsExportService, JiraGuideService], exports: [DefectsService] })
export class DefectsModule {}
