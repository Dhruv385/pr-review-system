import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@shared/env';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '@shared/database/prisma.service';
import { CryptoService } from '@shared/crypto/crypto.service';
import { GitlabApiClient } from './gitlab-api.client';

@Injectable()
export class GitlabAuthService {
  private readonly logger = new Logger(GitlabAuthService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly gitlabApi: GitlabApiClient,
  ) { }

  buildAuthorizationUrl(state: string): string {
    const params = new URLSearchParams();
    params.set('client_id', this.env.GITLAB.CLIENT_ID);
    params.set('redirect_uri', this.env.GITLAB.CALLBACK_URL);
    params.set('response_type', 'code');
    params.set('scope', 'read_api');
    params.set('state', state);
    return `https://gitlab.com/oauth/authorize?${params.toString()}`;
  }

  async connectAccount(userId: string, code: string): Promise<{ username: string }> {
    const accessToken = await this.exchangeCodeForToken(code);
    const verifiedUser = await this.gitlabApi.getAuthenticatedUser(accessToken);
    const encryptedToken = this.crypto.encrypt(accessToken);

    await this.prisma.gitlabAccount.upsert({
      where: { userId },
      create: {
        userId,
        gitlabId: String(verifiedUser.id),
        username: verifiedUser.username,
        accessToken: encryptedToken,
      },
      update: {
        gitlabId: String(verifiedUser.id),
        username: verifiedUser.username,
        accessToken: encryptedToken,
        tokenRevoked: false,
      },
    });

    return { username: verifiedUser.username };
  }

  private async exchangeCodeForToken(code: string): Promise<string> {
    if (!code) {
      throw new BadRequestException('Missing OAuth authorization code');
    }
    try {
      const { data } = await firstValueFrom(
        this.http.post('https://gitlab.com/oauth/token', {
          client_id: this.env.GITLAB.CLIENT_ID,
          client_secret: this.env.GITLAB.CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.env.GITLAB.CALLBACK_URL,
        }),
      );
      if (!data.access_token) {
        this.logger.warn(`GitLab token exchange failed: ${JSON.stringify(data)}`);
        throw new BadRequestException('GitLab authorization failed. Please try connecting again.');
      }
      return data.access_token;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('GitLab token exchange error', err as Error);
      throw new BadRequestException('GitLab authorization failed. Please try connecting again.');
    }
  }

  async getDecryptedToken(userId: string): Promise<string | null> {
    const account = await this.prisma.gitlabAccount.findUnique({ where: { userId } });
    if (!account || account.tokenRevoked) return null;
    return this.crypto.decrypt(account.accessToken);
  }
}
