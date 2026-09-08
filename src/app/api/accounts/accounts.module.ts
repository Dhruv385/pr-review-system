import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { OAuthStateService } from './oauth-state.service';
import { GithubModule } from '@api/github/github.module';
import { GitlabModule } from '@api/gitlab/gitlab.module';
import { CommonRedisModule } from '@shared/redis/redis.module';

@Module({
  imports: [
    CommonRedisModule,
    GithubModule,
    GitlabModule,
  ],
  controllers: [AccountsController],
  providers: [OAuthStateService],
})
export class AccountsModule { }
