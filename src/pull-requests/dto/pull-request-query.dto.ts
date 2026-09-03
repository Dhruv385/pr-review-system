import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PullRequestQueryDto {
  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], required: false, description: 'Filter pull requests by provider platform' })
  @IsOptional()
  @IsIn(['GITHUB', 'GITLAB'])
  platform?: 'GITHUB' | 'GITLAB';
}
