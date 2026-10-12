import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { GithubModule } from './github/github.module';
import { GitlabModule } from './gitlab/gitlab.module';
import { PullRequestsModule } from './pull-requests/pull-requests.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AiReviewModule } from './ai-review/ai-review.module';
import { SyncModule } from './sync/sync.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    AuthModule,
    AccountsModule,
    GithubModule,
    GitlabModule,
    PullRequestsModule,
    ReviewsModule,
    AiReviewModule,
    SyncModule,
    IntegrationsModule,
  ],
})
export class ApiModule {}
