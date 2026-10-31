import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { EnvironmentsService } from './environments.service';
import { RunsService } from './runs.service';
import { ScriptService } from './scripts/script.service';

@Module({ controllers: [ExecutionController], providers: [EnvironmentsService, ScriptService, RunsService], exports: [RunsService, EnvironmentsService] })
export class ExecutionModule {}
