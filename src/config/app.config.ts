import { IsDefined, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AppConfig {
  @IsDefined()
  @IsString()
  NODE_ENV!: string;

  @IsDefined()
  @IsNumber()
  @Min(1)
  PORT!: number;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;
}
