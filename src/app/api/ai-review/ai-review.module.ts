import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiReviewService } from './ai-review.service';
import { GithubModule } from '@api/github/github.module';
import { ReviewRulesModule } from '@api/review-rules/review-rules.module';

@Module({
  imports: [HttpModule, GithubModule, ReviewRulesModule],
  providers: [AiReviewService],
  exports: [AiReviewService],
})
export class AiReviewModule {}
