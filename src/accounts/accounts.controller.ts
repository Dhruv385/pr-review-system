import { Controller, Get, Headers, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IUser } from '@/common/interfaces/pr-review.interfaces';
import { GithubAuthService } from '@/github/github-auth.service';
import { GitlabAuthService } from '@/gitlab/gitlab-auth.service';
import { OAuthStateService } from './oauth-state.service';

@ApiTags('Accounts')
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly githubAuth: GithubAuthService,
    private readonly gitlabAuth: GitlabAuthService,
    private readonly oauthState: OAuthStateService,
  ) { }

  // GET /accounts/github/connect  (JWT-protected: this is where we know who's connecting)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate GitHub OAuth flow' })
  @ApiResponse({ status: 200, description: 'Returns the GitHub authorization URL for API clients' })
  @ApiResponse({ status: 302, description: 'Redirects to GitHub OAuth authorization' })
  @UseGuards(JwtAuthGuard)
  @Get('github/connect')
  async connectGithub(
    @CurrentUser() user: IUser,
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ) {
    const state = await this.oauthState.createState(user.id);
    const url = this.githubAuth.buildAuthorizationUrl(state);

    if (accept?.includes('application/json')) {
      return res.json({ authorizationUrl: url });
    }

    return res.redirect(url);
  }

  // GET /accounts/github/callback?code=...&state=...  (public: hit by the browser redirect from GitHub)
  @ApiOperation({ summary: 'GitHub OAuth callback handler' })
  @ApiQuery({ name: 'code', description: 'Authorization code from GitHub' })
  @ApiQuery({ name: 'state', description: 'OAuth state token for security' })
  @ApiResponse({ status: 200, description: 'GitHub account connected successfully' })
  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Query('state') state: string) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.githubAuth.connectAccount(userId, code);
    return { connected: true, provider: 'GITHUB', username: result.username };
  }

  // ---- GitLab ----

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate GitLab OAuth flow' })
  @ApiResponse({ status: 302, description: 'Redirects to GitLab OAuth authorization' })
  @UseGuards(JwtAuthGuard)
  @Get('gitlab/connect')
  async connectGitlab(@CurrentUser() user: IUser, @Res() res: Response) {
    const state = await this.oauthState.createState(user.id);
    const url = this.gitlabAuth.buildAuthorizationUrl(state);
    return res.redirect(url);
  }

  @ApiOperation({ summary: 'GitLab OAuth callback handler' })
  @ApiQuery({ name: 'code', description: 'Authorization code from GitLab' })
  @ApiQuery({ name: 'state', description: 'OAuth state token for security' })
  @ApiResponse({ status: 200, description: 'GitLab account connected successfully' })
  @Get('gitlab/callback')
  async gitlabCallback(@Query('code') code: string, @Query('state') state: string) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.gitlabAuth.connectAccount(userId, code);
    return { connected: true, provider: 'GITLAB', username: result.username };
  }
}
