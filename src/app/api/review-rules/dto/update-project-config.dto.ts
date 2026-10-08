import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProjectConfigDto {
  @ApiProperty({
    required: false,
    description: "This project's architecture and coding standards — used to judge PRs against its own conventions instead of generic best practice.",
    example: 'NestJS modular monolith. Controllers stay thin; business logic lives in services. DTOs validate all external input.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  architectureNotes?: string;

  @ApiProperty({
    required: false,
    description: 'Project-specific development conventions and guidelines.',
    example: 'Prefer composition over inheritance. All async I/O goes through the shared HttpService, never raw fetch.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  conventions?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Specific areas to prioritize in every review of this project.',
    example: ['authorization checks', 'SQL injection', 'N+1 queries'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  focusAreas?: string[];

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Glob patterns for paths fully excluded from review (enforced in code, not just a prompt hint).',
    example: ['**/*.generated.ts', 'legacy/**'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  excludePatterns?: string[];
}
