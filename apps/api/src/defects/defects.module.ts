import { Module } from '@nestjs/common';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';
import { DefectsExportService } from './defects-export';

@Module({ controllers: [DefectsController], providers: [DefectsService, DefectsExportService], exports: [DefectsService] })
export class DefectsModule {}
