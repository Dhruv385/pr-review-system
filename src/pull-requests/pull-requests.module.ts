import { forwardRef, Module } from '@nestjs/common';
import { PullRequestsController } from './pull-requests.controller';
import { PullRequestsService } from './pull-requests.service';
import { SyncModule } from '@/common/sync.module';
import { ReviewsModule } from '@/reviews/reviews.module';
import { DatabaseModule } from '@/database/database.module';
import { AiReviewModule } from '@/ai-review/ai-review.module';

@Module({
  imports: [DatabaseModule, SyncModule, forwardRef(() => ReviewsModule), AiReviewModule],
  controllers: [PullRequestsController],
  providers: [PullRequestsService],
  exports: [PullRequestsService],
})
export class PullRequestsModule { }
