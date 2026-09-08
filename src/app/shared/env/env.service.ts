import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@config/index';

/**
 * Typed, validated access to environment configuration. Values are grouped
 * and validated once at boot (see env.module.ts) so every property here is
 * guaranteed defined — no more scattered `if (!x) throw` guards.
 *
 * Fields are assigned in the constructor body, not via field initializers:
 * with this project's ES2022 target, native class fields run before the
 * constructor body, so a field initializer calling `this.get(...)` would
 * read `this.config` before the parameter property assigns it.
 */
@Injectable()
export class EnvService {
  readonly APP: EnvConfig['APP'];
  readonly DATABASE: EnvConfig['DATABASE'];
  readonly REDIS: EnvConfig['REDIS'];
  readonly JWT: EnvConfig['JWT'];
  readonly AUTH: EnvConfig['AUTH'];
  readonly GITHUB: EnvConfig['GITHUB'];
  readonly GITLAB: EnvConfig['GITLAB'];
  readonly AI: EnvConfig['AI'];
  readonly SECURITY: EnvConfig['SECURITY'];
  readonly SYNC: EnvConfig['SYNC'];

  constructor(private config: ConfigService<EnvConfig, true>) {
    this.APP = this.get('APP');
    this.DATABASE = this.get('DATABASE');
    this.REDIS = this.get('REDIS');
    this.JWT = this.get('JWT');
    this.AUTH = this.get('AUTH');
    this.GITHUB = this.get('GITHUB');
    this.GITLAB = this.get('GITLAB');
    this.AI = this.get('AI');
    this.SECURITY = this.get('SECURITY');
    this.SYNC = this.get('SYNC');
  }

  get NODE_ENV(): string {
    return this.APP.NODE_ENV;
  }

  get PORT(): number {
    return this.APP.PORT;
  }

  get CORS_ORIGINS(): string {
    return this.APP.CORS_ORIGINS ?? '';
  }

  get IS_PRODUCTION(): boolean {
    return this.NODE_ENV === 'production';
  }

  get<Key extends keyof EnvConfig>(key: Key): EnvConfig[Key] {
    return this.config.get(key, { infer: true });
  }
}
