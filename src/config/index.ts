import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';

import { AppConfig } from './app.config';
import { DatabaseConfig } from './database.config';
import { RedisConfig } from './redis.config';
import { JwtConfig } from './jwt.config';
import { AuthConfig } from './auth.config';
import { GithubConfig } from './github.config';
import { GitlabConfig } from './gitlab.config';
import { AiConfig } from './ai.config';
import { SecurityConfig } from './security.config';
import { SyncConfig } from './sync.config';

export { AppConfig } from './app.config';
export { DatabaseConfig } from './database.config';
export { RedisConfig } from './redis.config';
export { JwtConfig } from './jwt.config';
export { AuthConfig } from './auth.config';
export { GithubConfig } from './github.config';
export { GitlabConfig } from './gitlab.config';
export { AiConfig } from './ai.config';
export { SecurityConfig } from './security.config';
export { SyncConfig } from './sync.config';

/**
 * Full shape of validated, typed environment configuration. Built by
 * EnvModule's `validate()` from today's flat `.env` keys — see
 * env.module.ts for the flat-key -> nested-object mapping.
 */
export class EnvConfig {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AppConfig)
  APP!: AppConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => DatabaseConfig)
  DATABASE!: DatabaseConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RedisConfig)
  REDIS!: RedisConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => JwtConfig)
  JWT!: JwtConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AuthConfig)
  AUTH!: AuthConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => GithubConfig)
  GITHUB!: GithubConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => GitlabConfig)
  GITLAB!: GitlabConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AiConfig)
  AI!: AiConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SecurityConfig)
  SECURITY!: SecurityConfig;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SyncConfig)
  SYNC!: SyncConfig;
}
