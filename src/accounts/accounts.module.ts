import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { OAuthStateService } from './oauth-state.service';
import { GithubModule } from '@/github/github.module';
import { GitlabModule } from '@/gitlab/gitlab.module';
import { CommonRedisModule } from '@/common/redis.module';

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
