import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { AccountsController } from './accounts.controller';
import { OAuthStateService } from './oauth-state.service';
import { GithubModule } from '@/github/github.module';
import { GitlabModule } from '@/gitlab/gitlab.module';

@Module({
  imports: [
    RedisModule.forRoot({
      type: 'single',
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    }),
    GithubModule,
    GitlabModule,
  ],
  controllers: [AccountsController],
  providers: [OAuthStateService],
})
export class AccountsModule { }
