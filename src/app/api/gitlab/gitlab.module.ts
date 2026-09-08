import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GitlabAuthService } from './gitlab-auth.service';
import { GitlabApiClient } from './gitlab-api.client';
import { GitlabService } from './gitlab.service';
import { CryptoModule } from '@shared/crypto/crypto.module';
import { DatabaseModule } from '@shared/database/database.module';

@Module({
  imports: [HttpModule, DatabaseModule, CryptoModule],
  providers: [GitlabAuthService, GitlabApiClient, GitlabService],
  exports: [GitlabAuthService, GitlabService],
})
export class GitlabModule { }
