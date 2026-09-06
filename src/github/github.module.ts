import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GithubAuthService } from './github-auth.service';
import { GithubApiClient } from './github-api.client';
import { GithubService } from './github.service';
import { CommonModule } from '@/common/common.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [HttpModule, DatabaseModule, CommonModule],
  providers: [GithubAuthService, GithubApiClient, GithubService],
  exports: [GithubAuthService, GithubService, GithubApiClient],
})
export class GithubModule { }
