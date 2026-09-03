import { forwardRef, Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SyncModule } from '@/common/sync.module';
import { PullRequestsModule } from '@/pull-requests/pull-requests.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule, SyncModule, forwardRef(() => PullRequestsModule)],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule { }
