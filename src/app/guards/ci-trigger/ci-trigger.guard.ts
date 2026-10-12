import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { EnvService } from '@shared/env';

/**
 * Gates the CI-facing integration surface (POST /integrations/trigger-review)
 * with a single static shared secret, instead of the per-user JWT/OAuth flow
 * the rest of the app uses — a CI workflow has no human session to log in
 * with. Two things make this safe to use as a long-lived, repo-wide secret:
 *
 *  - Constant-time comparison (timingSafeEqual) so a network attacker can't
 *    recover the secret byte-by-byte via response timing, the way a plain
 *    `===` comparison would leak.
 *  - Requires HTTPS in production, so the secret is never sent in the clear
 *    over a path an attacker could passively observe.
 */
@Injectable()
export class CiTriggerGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    if (this.env.IS_PRODUCTION && !this.isSecureRequest(req)) {
      throw new ForbiddenException('This endpoint requires HTTPS.');
    }

    const authHeader: string | undefined = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    if (!token || !this.isValidSecret(token)) {
      throw new UnauthorizedException('Invalid or missing CI trigger credentials.');
    }

    return true;
  }

  private isSecureRequest(req: { secure?: boolean; headers: Record<string, unknown> }): boolean {
    // req.secure is only set correctly if Express's `trust proxy` is
    // configured for the deployment's reverse proxy — check both so this
    // doesn't silently accept plaintext behind a misconfigured proxy.
    return Boolean(req.secure) || req.headers['x-forwarded-proto'] === 'https';
  }

  private isValidSecret(token: string): boolean {
    const expected = Buffer.from(this.env.INTEGRATIONS.CI_TRIGGER_SECRET);
    const provided = Buffer.from(token);

    // timingSafeEqual throws on a length mismatch rather than returning
    // false, and the length check itself isn't secret-dependent, so this
    // stays constant-time with respect to the secret's actual content.
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  }
}
