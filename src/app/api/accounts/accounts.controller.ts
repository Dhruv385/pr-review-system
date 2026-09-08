import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@guards/jwt';
import { CurrentUser } from '@decorators/current-user.decorator';
import { IUser } from '@app/interfaces/pr-review.interfaces';
import { GithubAuthService } from '@api/github/github-auth.service';
import { GitlabAuthService } from '@api/gitlab/gitlab-auth.service';
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
  // Returns the authorization URL as JSON — the caller is responsible for
  // opening it in a browser (never fetch() it; GitHub doesn't send CORS
  // headers back, so a fetch that follows the redirect will be blocked).
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
  @ApiResponse({ status: 200, description: 'GitHub account connected successfully' })
  @ApiResponse({ status: 401, description: 'OAuth state is missing, expired, or already used' })
  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Query('state') state: string) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.githubAuth.connectAccount(userId, code);
    return { connected: true, provider: 'GITHUB', username: result.username };
  }

  // ---- GitLab ----

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
  @ApiResponse({ status: 200, description: 'GitLab account connected successfully' })
  @ApiResponse({ status: 401, description: 'OAuth state is missing, expired, or already used' })
  @Get('gitlab/callback')
  async gitlabCallback(@Query('code') code: string, @Query('state') state: string) {
    const userId = await this.oauthState.consumeState(state);
    const result = await this.gitlabAuth.connectAccount(userId, code);
    return { connected: true, provider: 'GITLAB', username: result.username };
  }
}
