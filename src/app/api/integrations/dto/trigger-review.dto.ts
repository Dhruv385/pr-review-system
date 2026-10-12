import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class TriggerReviewDto {
  @ApiProperty({ example: 'owner/repo-name', description: 'Full repository name, exactly as GitHub reports it' })
  @IsString()
  @MaxLength(200)
  // Deliberately strict: this value is interpolated directly into GitHub API
  // URLs downstream (GithubApiClient), so it's validated against the shape
  // GitHub itself allows rather than just checked for presence.
  @Matches(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, { message: 'repositoryFullName must be in the form owner/repo' })
  repositoryFullName!: string;

  @ApiProperty({ example: 42, description: 'Pull request number' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  number!: number;

  @ApiProperty({ example: 'Fix: handle null response from upstream API' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiProperty({ required: false, description: "The pull request's description/body, if available" })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;
}
