import { IsDefined, IsString, MinLength } from 'class-validator';

/**
 * Machine-to-machine trigger surface (e.g. a CI workflow in another repo
 * calling POST /integrations/trigger-review). MinLength(32) on the secret is
 * a boot-time guard against ever deploying with a weak or missing value —
 * the app refuses to start rather than accept a trivially guessable secret.
 */
export class IntegrationsConfig {
  @IsDefined()
  @IsString()
  @MinLength(32)
  CI_TRIGGER_SECRET!: string;

  @IsDefined()
  @IsString()
  CI_TRIGGER_USER_ID!: string;
}
