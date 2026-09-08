import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/dto/pagination-query.dto';

export class PullRequestQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], required: false, description: 'Filter pull requests by provider platform' })
  @IsOptional()
  @IsIn(['GITHUB', 'GITLAB'])
  platform?: 'GITHUB' | 'GITLAB';

  @ApiProperty({
    required: false,
    description: 'Bypass the staleness check and sync against GitHub/GitLab immediately, regardless of PR_SYNC_STALE_MINUTES',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  forceSync?: boolean;
}
