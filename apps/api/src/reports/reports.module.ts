import { Module } from '@nestjs/common';
import { RequirementsModule } from '../requirements/requirements.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { MetricsService } from './metrics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ClosureController } from './closure.controller';
import { ClosureService } from './closure.service';

@Module({ imports: [RequirementsModule, MonitoringModule], controllers: [ReportsController, ClosureController], providers: [MetricsService, ReportsService, ClosureService], exports: [MetricsService, ReportsService] })
export class ReportsModule {}
