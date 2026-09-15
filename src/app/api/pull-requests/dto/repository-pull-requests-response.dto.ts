import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Platform } from '@app/interfaces/pr-review.interfaces';
import { PullRequestResponseDto } from './pull-request-response.dto';

export class RepositoryPullRequestsDto {
  @ApiProperty({ example: 'owner/repo-name', description: 'Full repository name in the form owner/repo' })
  @Expose()
  repositoryFullName!: string;

  @ApiProperty({ example: 'repo-name', description: 'Repository name' })
  @Expose()
  repositoryName!: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], description: 'Platform' })
  @Expose()
  platform!: Platform;

  @ApiProperty({ type: [PullRequestResponseDto], description: 'This repository\'s pull requests, latest first' })
  @Expose()
  pullRequests!: PullRequestResponseDto[];
}

export class RepositoryPullRequestsListResponseDto {
  @ApiProperty({
    type: [RepositoryPullRequestsDto],
    description: "Repositories ordered by their most recently updated pull request, latest first",
  })
  @Expose()
  repositories!: RepositoryPullRequestsDto[];
}
