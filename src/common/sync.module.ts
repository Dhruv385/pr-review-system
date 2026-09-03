import { Module } from '@nestjs/common';
import { SyncCoordinatorService } from './services/sync-coordinator.service';
import { GithubModule } from '@/github/github.module';
import { GitlabModule } from '@/gitlab/gitlab.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule, GithubModule, GitlabModule],
  providers: [SyncCoordinatorService],
  exports: [SyncCoordinatorService],
})
export class SyncModule { }
