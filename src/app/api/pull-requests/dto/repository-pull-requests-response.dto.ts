import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Platform } from '@app/interfaces/pr-review.interfaces';
import { PullRequestResponseDto } from './pull-request-response.dto';

export class RepositoryPullRequestsDto {
  @ApiProperty({ example: 'owner/repo-name' })
  @Expose()
  repositoryFullName!: string;

  @ApiProperty({ example: 'repo-name' })
  @Expose()
  repositoryName!: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB'] })
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
