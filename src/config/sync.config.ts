import { IsNumber, IsOptional } from 'class-validator';

export class SyncConfig {
  @IsOptional()
  @IsNumber()
  STALE_MINUTES?: number;
}
