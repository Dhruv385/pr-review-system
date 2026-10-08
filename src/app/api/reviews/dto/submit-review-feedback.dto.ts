import { ApiProperty } from '@nestjs/swagger';
import { AiReviewRating } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitReviewFeedbackDto {
  @ApiProperty({ enum: AiReviewRating, description: 'How accurate this AI-generated review was.' })
  @IsEnum(AiReviewRating)
  rating!: AiReviewRating;

  @ApiProperty({ required: false, description: 'Optional free-text note on why, or what was wrong/right.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
