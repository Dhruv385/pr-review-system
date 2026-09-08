import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/dto/pagination-query.dto';

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], required: false, description: 'Filter reviews by provider platform' })
  @IsOptional()
  @IsIn(['GITHUB', 'GITLAB'])
  platform?: 'GITHUB' | 'GITLAB';
}
