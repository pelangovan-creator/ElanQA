import { Module } from '@nestjs/common';
import { RequirementsModule } from '../requirements/requirements.module';
import { ArtefactsController } from './artefacts.controller';
import { ClarificationsService } from './clarifications.service';
import { DesignService } from './design/design.service';
import { DocsService } from './docs.service';
import { ReviewService } from './review.service';

@Module({
  imports: [RequirementsModule],
  controllers: [ArtefactsController],
  providers: [ReviewService, ClarificationsService, DesignService, DocsService],
  exports: [DesignService],
})
export class ArtefactsModule {}
