import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReviewRuleDto {
  @ApiProperty({ example: 'Always use QueryBuilder instead of raw SQL in repositories.' })
  @IsString()
  @MaxLength(500)
  text!: string;

  @ApiProperty({
    example: 'src/**/*.repository.ts',
    required: false,
    description: 'Glob matched against changed file paths in future reviews. Omit to apply to every file.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pattern?: string;

  @ApiProperty({
    enum: ['manual', 'pr-comment'],
    required: false,
    default: 'manual',
    description: 'Where this rule came from — informational provenance only, does not affect matching.',
  })
  @IsOptional()
  @IsIn(['manual', 'pr-comment'])
  source?: 'manual' | 'pr-comment';
}
