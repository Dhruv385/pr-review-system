import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EnvService } from '@shared/env';
import { PassportStrategy } from '@nestjs/passport';
import { BasicStrategy as Strategy } from 'passport-http';

/**
 * Shared-credential gate in front of the public /auth/register and
 * /auth/login endpoints — a single fixed username/password pair (not
 * per-user) meant to keep anonymous bots off the signup/login surface. This
 * is a layer in front of, not instead of, the per-user JWT flow those
 * endpoints issue on success.
 */
@Injectable()
export class BasicStrategy extends PassportStrategy(Strategy, 'basic') {
  private readonly username: string;
  private readonly password: string;

  constructor(env: EnvService) {
    super();
    this.username = env.AUTH.USERNAME;
    this.password = env.AUTH.PASSWORD;
  }

  validate(username: string, password: string): boolean {
    if (username === this.username && password === this.password) {
      return true;
    }
    throw new UnauthorizedException('Invalid credentials');
  }
}
