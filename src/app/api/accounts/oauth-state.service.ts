import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis'; // swap for your project's existing Redis injection

const STATE_TTL_SECONDS = 600; // 10 minutes to complete the OAuth round trip
const KEY_PREFIX = 'oauth_state:';

/**
 * The GitHub/GitLab OAuth callback is hit by the USER'S BROWSER as a plain
 * redirect — it carries no Authorization header, so we can't rely on the
 * JWT guard there. Instead:
 *   1. /connect (JWT-protected) generates a random `state`, stores
 *      `state -> userId` in Redis with a short TTL, and redirects to the
 *      provider with that state.
 *   2. /callback (public) reads `state` from the query string, looks up the
 *      userId in Redis, and deletes the entry (single use).
 *
 * This is what prevents a forged callback from attaching a GitHub/GitLab
 * account to the wrong user — the state value is unguessable and single-use.
 */
@Injectable()
export class OAuthStateService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async createState(userId: string): Promise<string> {
    const state = randomUUID();
    await this.redis.set(`${KEY_PREFIX}${state}`, userId, 'EX', STATE_TTL_SECONDS);
    return state;
  }

  async consumeState(state: string): Promise<string> {
    const key = `${KEY_PREFIX}${state}`;
    const userId = await this.redis.get(key);
    if (!userId) {
      throw new UnauthorizedException('OAuth session expired or invalid. Please try connecting again.');
    }
    await this.redis.del(key);
    return userId;
  }
}
