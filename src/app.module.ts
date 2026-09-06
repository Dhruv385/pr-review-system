import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { PullRequestsModule } from './pull-requests/pull-requests.module';
import { ReviewsModule } from './reviews/reviews.module';
import { GithubModule } from './github/github.module';
import { GitlabModule } from './gitlab/gitlab.module';
import { SyncModule } from './common/sync.module';
import { DatabaseModule } from './database/database.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        HttpModule,
        DatabaseModule,
        AuthModule,
        AccountsModule,
        PullRequestsModule,
        ReviewsModule,
        GithubModule,
        GitlabModule,
        SyncModule,
    ],
})
export class AppModule { }
