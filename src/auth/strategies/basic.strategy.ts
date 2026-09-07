import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(config: ConfigService) {
    super();
    const username = config.get<string>('AUTH_BASIC_USERNAME');
    const password = config.get<string>('AUTH_BASIC_PASSWORD');
    if (!username || !password) {
      throw new Error('AUTH_BASIC_USERNAME / AUTH_BASIC_PASSWORD are not set');
    }
    this.username = username;
    this.password = password;
  }

  validate(username: string, password: string): boolean {
    if (username === this.username && password === this.password) {
      return true;
    }
    throw new UnauthorizedException('Invalid credentials');
  }
}
