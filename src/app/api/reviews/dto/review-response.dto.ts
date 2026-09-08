import { Expose, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ReviewState } from '@app/interfaces/pr-review.interfaces';

export class ReviewResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @Expose()
  id!: string;

  @ApiProperty({ example: 'octocat' })
  @Expose()
  @Transform(({ obj }) => obj.reviewerName)
  reviewer!: string;

  @ApiProperty({ enum: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING'] })
  @Expose()
  state!: ReviewState;

  @ApiProperty({ example: 'Looks good to me!', nullable: true })
  @Expose()
  comment!: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', required: false })
  @Expose()
  pullRequestId?: string;
}

export class ReviewListResponseDto {
  @ApiProperty({ type: [ReviewResponseDto] })
  @Expose()
  reviews!: ReviewResponseDto[];
}
