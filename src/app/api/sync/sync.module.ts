import { Module } from '@nestjs/common';
import { SyncCoordinatorService } from './sync-coordinator.service';
import { GithubModule } from '@api/github/github.module';
import { GitlabModule } from '@api/gitlab/gitlab.module';
import { DatabaseModule } from '@shared/database/database.module';

@Module({
  imports: [DatabaseModule, GithubModule, GitlabModule],
  providers: [SyncCoordinatorService],
  exports: [SyncCoordinatorService],
})
export class SyncModule { }
