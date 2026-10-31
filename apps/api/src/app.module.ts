import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { AuditModule } from './audit/audit.module';
import { AiModule } from './ai/ai.service';
import { RequirementsModule } from './requirements/requirements.module';
import { ArtefactsModule } from './artefacts/artefacts.module';
import { ExecutionModule } from './execution/execution.module';
import { DefectsModule } from './defects/defects.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ReportsModule } from './reports/reports.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    AuditModule,
    AiModule,
    RequirementsModule,
    ArtefactsModule,
    ExecutionModule,
    DefectsModule,
    MonitoringModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
