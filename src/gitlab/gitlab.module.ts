import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GitlabAuthService } from './gitlab-auth.service';
import { GitlabApiClient } from './gitlab-api.client';
import { GitlabService } from './gitlab.service';
import { CommonModule } from '@/common/common.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [HttpModule, DatabaseModule, CommonModule],
  providers: [GitlabAuthService, GitlabApiClient, GitlabService],
  exports: [GitlabAuthService, GitlabService],
})
export class GitlabModule { }
