import { IsDefined, IsString } from 'class-validator';

export class RedisConfig {
  @IsDefined()
  @IsString()
  URL!: string;
}
