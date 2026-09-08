import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvConfig } from '@config/index';
import { EnvService } from './env.service';

/**
 * Groups today's flat `.env` keys (GITHUB_CLIENT_ID, JWT_SECRET, ...) into
 * the nested shape EnvConfig expects, then validates the result once at
 * boot. Deliberately does not require renaming anything in `.env`.
 */
function groupFlatConfig(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    APP: {
      NODE_ENV: raw.NODE_ENV,
      PORT: raw.PORT,
      CORS_ORIGINS: raw.CORS_ORIGINS,
    },
    DATABASE: {
      URL: raw.DATABASE_URL,
    },
    REDIS: {
      URL: raw.REDIS_URL ?? 'redis://localhost:6379',
    },
    JWT: {
      SECRET: raw.JWT_SECRET,
    },
    AUTH: {
      USERNAME: raw.AUTH_BASIC_USERNAME,
      PASSWORD: raw.AUTH_BASIC_PASSWORD,
    },
    GITHUB: {
      CLIENT_ID: raw.GITHUB_CLIENT_ID,
      CLIENT_SECRET: raw.GITHUB_CLIENT_SECRET,
      CALLBACK_URL: raw.GITHUB_OAUTH_CALLBACK_URL,
    },
    GITLAB: {
      CLIENT_ID: raw.GITLAB_CLIENT_ID,
      CLIENT_SECRET: raw.GITLAB_CLIENT_SECRET,
      CALLBACK_URL: raw.GITLAB_OAUTH_CALLBACK_URL,
    },
    AI: {
      GROQ_API_KEY: raw.GROQ_API_KEY,
      GROQ_MODEL: raw.GROQ_MODEL,
    },
    SECURITY: {
      ENCRYPTION_KEY: raw.ENCRYPTION_KEY,
    },
    SYNC: {
      STALE_MINUTES: raw.PR_SYNC_STALE_MINUTES,
    },
  };
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate(raw: Record<string, unknown>) {
        const grouped = groupFlatConfig(raw);
        const validatedConfig = plainToInstance(EnvConfig, grouped, {
          enableImplicitConversion: true,
        });
        const errors = validateSync(validatedConfig, { skipMissingProperties: false });

        if (errors.length > 0) {
          throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
        }
        return validatedConfig;
      },
    }),
  ],
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
