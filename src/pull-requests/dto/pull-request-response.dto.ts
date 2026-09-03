import { Expose, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Platform, PullRequestStatus } from '@/common/interfaces/pr-review.interfaces';

export class PullRequestResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @Expose()
  id!: string;

  @ApiProperty({ example: '12345' })
  @Expose()
  externalId!: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB'] })
  @Expose()
  platform!: Platform;

  @ApiProperty({ example: 42 })
  @Expose()
  number!: number;

  @ApiProperty({ example: 'Fix: Add missing error handling' })
  @Expose()
  title!: string;

  @ApiProperty({ example: 'owner/repo-name' })
  @Expose()
  @Transform(({ obj }) => obj.repositoryFullName)
  repository!: string;

  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'MERGED', 'DRAFT'] })
  @Expose()
  status!: PullRequestStatus;

  @ApiProperty({ example: 3 })
  @Expose()
  @Transform(({ obj }) => obj._count?.reviews ?? obj.reviews?.length ?? 0)
  reviewCount!: number;
}

export class PullRequestListResponseDto {
  @ApiProperty({ type: [PullRequestResponseDto] })
  @Expose()
  pullRequests!: PullRequestResponseDto[];
}
