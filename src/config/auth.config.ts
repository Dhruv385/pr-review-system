import { IsDefined, IsString } from 'class-validator';

/** Shared client Basic Auth credential gating /auth/register and /auth/login. */
export class AuthConfig {
  @IsDefined()
  @IsString()
  USERNAME!: string;

  @IsDefined()
  @IsString()
  PASSWORD!: string;
}
