import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiReviewService } from './ai-review.service';
import { GithubModule } from '@api/github/github.module';

@Module({
  imports: [HttpModule, GithubModule],
  providers: [AiReviewService],
  exports: [AiReviewService],
})
export class AiReviewModule {}
