import { Module } from '@nestjs/common';
import { ReviewRulesService } from './review-rules.service';
import { GithubModule } from '@api/github/github.module';

@Module({
  imports: [GithubModule],
  providers: [ReviewRulesService],
  exports: [ReviewRulesService],
})
export class ReviewRulesModule {}
