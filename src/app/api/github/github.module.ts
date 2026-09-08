import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GithubAuthService } from './github-auth.service';
import { GithubApiClient } from './github-api.client';
import { GithubService } from './github.service';
import { CryptoModule } from '@shared/crypto/crypto.module';
import { DatabaseModule } from '@shared/database/database.module';

@Module({
  imports: [HttpModule, DatabaseModule, CryptoModule],
  providers: [GithubAuthService, GithubApiClient, GithubService],
  exports: [GithubAuthService, GithubService, GithubApiClient],
})
export class GithubModule { }
