import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '@/database/prisma.service';
import { CryptoService } from '@/common/services/crypto.service';
import { GithubApiClient } from './github-api.client';

/**
 * Handles the OAuth handshake and persists the verified GitHub account.
 * Never receives or stores a GitHub password — only the OAuth `code` the
 * browser redirect hands back, which is exchanged server-side for a token.
 */
@Injectable()
export class GithubAuthService {
  private readonly logger = new Logger(GithubAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly githubApi: GithubApiClient,
  ) { }

  /** Step 1: build the URL the frontend redirects the user to. */
  buildAuthorizationUrl(state: string): string {
    const clientId = this.config.get<string>('GITHUB_CLIENT_ID');
    const redirectUri = this.config.get<string>('GITHUB_OAUTH_CALLBACK_URL');
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (redirectUri) params.set('redirect_uri', redirectUri);
    params.set('scope', 'repo read:user');
    params.set('state', state);
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Step 2: exchange the OAuth `code` for an access token, verify the
   * resulting identity against GitHub, then upsert the account for
   * `userId` — which must come from a verified source (the JWT-authenticated
   * /connect step via OAuthStateService), never from client-supplied input
   * on the callback itself.
   */
  async connectAccount(userId: string, code: string): Promise<{ username: string }> {
    const accessToken = await this.exchangeCodeForToken(code);

    // Verify the token by calling GitHub with it — this is the "verified account" step.
    const verifiedUser = await this.githubApi.getAuthenticatedUser(accessToken);

    const encryptedToken = this.crypto.encrypt(accessToken);

    await this.prisma.githubAccount.upsert({
      where: { userId },
      create: {
        userId,
        githubId: String(verifiedUser.id),
        username: verifiedUser.login,
        accessToken: encryptedToken,
      },
      update: {
        githubId: String(verifiedUser.id),
        username: verifiedUser.login,
        accessToken: encryptedToken,
        tokenRevoked: false,
      },
    });

    return { username: verifiedUser.login };
  }

  private async exchangeCodeForToken(code: string): Promise<string> {
    if (!code) {
      throw new BadRequestException('Missing OAuth authorization code');
    }
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: this.config.get<string>('GITHUB_CLIENT_ID'),
            client_secret: this.config.get<string>('GITHUB_CLIENT_SECRET'),
            code,
            redirect_uri: this.config.get<string>('GITHUB_OAUTH_CALLBACK_URL'),
          },
          { headers: { Accept: 'application/json' } },
        ),
      );
      if (!data.access_token) {
        this.logger.warn(`GitHub token exchange failed: ${JSON.stringify(data)}`);
        throw new BadRequestException('GitHub authorization failed. Please try connecting again.');
      }
      return data.access_token;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('GitHub token exchange error', err as Error);
      throw new BadRequestException('GitHub authorization failed. Please try connecting again.');
    }
  }

  /** Returns the decrypted access token for a user, or null if not connected. */
  async getDecryptedToken(userId: string): Promise<string | null> {
    const account = await this.prisma.githubAccount.findUnique({ where: { userId } });
    if (!account || account.tokenRevoked) return null;
    return this.crypto.decrypt(account.accessToken);
  }
}
