import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewQueryDto {
  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], required: false, description: 'Filter reviews by provider platform' })
  @IsOptional()
  @IsIn(['GITHUB', 'GITLAB'])
  platform?: 'GITHUB' | 'GITLAB';
}
