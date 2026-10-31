import { Module } from '@nestjs/common';
import { RequirementsModule } from '../requirements/requirements.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { MetricsService } from './metrics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [RequirementsModule, MonitoringModule], controllers: [ReportsController], providers: [MetricsService, ReportsService], exports: [MetricsService, ReportsService] })
export class ReportsModule {}
