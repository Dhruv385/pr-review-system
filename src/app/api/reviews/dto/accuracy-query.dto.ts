import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class AccuracyQueryDto {
  @ApiProperty({ required: false, description: 'Narrow to one repository, e.g. "owner/repo".' })
  @IsOptional()
  @IsString()
  repositoryFullName?: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB'], required: false, description: 'Narrow to one provider platform' })
  @IsOptional()
  @IsIn(['GITHUB', 'GITLAB'])
  platform?: 'GITHUB' | 'GITLAB';
}
