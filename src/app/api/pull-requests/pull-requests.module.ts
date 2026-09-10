import { forwardRef, Module } from '@nestjs/common';
import { PullRequestsController } from './pull-requests.controller';
import { PullRequestsService } from './pull-requests.service';
import { SyncModule } from '@api/sync/sync.module';
import { ReviewsModule } from '@api/reviews/reviews.module';
import { DatabaseModule } from '@shared/database/database.module';
import { AiReviewModule } from '@api/ai-review/ai-review.module';
import { ReviewRulesModule } from '@api/review-rules/review-rules.module';

@Module({
  imports: [DatabaseModule, SyncModule, forwardRef(() => ReviewsModule), AiReviewModule, ReviewRulesModule],
  controllers: [PullRequestsController],
  providers: [PullRequestsService],
  exports: [PullRequestsService],
})
export class PullRequestsModule { }
