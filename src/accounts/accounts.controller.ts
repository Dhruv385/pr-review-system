import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
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
  // Returns the authorization URL as JSON — the frontend owns the actual
  // browser navigation to it, this API never redirects.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the GitHub OAuth authorization URL to redirect the user to' })
  @ApiResponse({ status: 200, description: 'Returns the GitHub authorization URL' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @UseGuards(JwtAuthGuard)
  @Get('github/connect')
  async connectGithub(@CurrentUser() user: IUser) {
    const state = await this.oauthState.createState(user.id);
    const authorizationUrl = this.githubAuth.buildAuthorizationUrl(state);
    return { authorizationUrl };
  }

  // GET /accounts/github/callback?code=...&state=...  (public: hit by the browser redirect from GitHub)
  @ApiOperation({ summary: 'GitHub OAuth callback handler' })
  @ApiQuery({ name: 'code', description: 'Authorization code from GitHub' })
  @ApiQuery({ name: 'state', description: 'OAuth state token for security' })
  @ApiResponse({ status: 302, description: 'Redirects back into the dashboard once connected' })
  @ApiResponse({ status: 401, description: 'OAuth state is missing, expired, or already used' })
  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.githubAuth.connectAccount(userId, code);
    return res.redirect(`/?connected=github&username=${encodeURIComponent(result.username)}`);
  }

  // ---- GitLab ----

  // Same pattern as GitHub above — JSON only, frontend does the navigation.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the GitLab OAuth authorization URL to redirect the user to' })
  @ApiResponse({ status: 200, description: 'Returns the GitLab authorization URL' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @UseGuards(JwtAuthGuard)
  @Get('gitlab/connect')
  async connectGitlab(@CurrentUser() user: IUser) {
    const state = await this.oauthState.createState(user.id);
    const authorizationUrl = this.gitlabAuth.buildAuthorizationUrl(state);
    return { authorizationUrl };
  }

  @ApiOperation({ summary: 'GitLab OAuth callback handler' })
  @ApiQuery({ name: 'code', description: 'Authorization code from GitLab' })
  @ApiQuery({ name: 'state', description: 'OAuth state token for security' })
  @ApiResponse({ status: 302, description: 'Redirects back into the dashboard once connected' })
  @ApiResponse({ status: 401, description: 'OAuth state is missing, expired, or already used' })
  @Get('gitlab/callback')
  async gitlabCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.gitlabAuth.connectAccount(userId, code);
    return res.redirect(`/?connected=gitlab&username=${encodeURIComponent(result.username)}`);
  }
}
