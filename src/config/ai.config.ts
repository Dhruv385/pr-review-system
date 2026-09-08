import { IsOptional, IsString } from 'class-validator';

/**
 * Both optional: AI review is a soft-fail feature, not a boot-time
 * requirement. AiReviewService throws a friendly ServiceUnavailableException
 * at request time if GROQ_API_KEY is unset, so the rest of the app must stay
 * usable without it.
 */
export class AiConfig {
  @IsOptional()
  @IsString()
  GROQ_API_KEY?: string;

  @IsOptional()
  @IsString()
  GROQ_MODEL?: string;
}
