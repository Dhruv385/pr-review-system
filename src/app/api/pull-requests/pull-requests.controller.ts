import { BadRequestException, Body, Controller, Get, Inject, forwardRef, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@guards/jwt';
import { CurrentUser } from '@decorators/current-user.decorator';
import { IUser, Platform } from '@app/interfaces/pr-review.interfaces';
import { PullRequestsService } from './pull-requests.service';
import { ReviewsService } from '@api/reviews/reviews.service';
import { AiReviewService } from '@api/ai-review/ai-review.service';
import { ReviewRulesService } from '@api/review-rules/review-rules.service';
import { PullRequestQueryDto } from './dto/pull-request-query.dto';
import { RepositoryPullRequestsListResponseDto } from './dto/repository-pull-requests-response.dto';
import { CreateReviewRuleDto } from '@api/review-rules/dto/create-review-rule.dto';
import { UpdateProjectConfigDto } from '@api/review-rules/dto/update-project-config.dto';
import { buildPaginationMeta } from '@utils/pagination.util';

@ApiTags('Pull Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('pull-requests')
export class PullRequestsController {
  constructor(
    private readonly pullRequestsService: PullRequestsService,
    @Inject(forwardRef(() => ReviewsService))
    private readonly reviewsService: ReviewsService,
    private readonly aiReviewService: AiReviewService,
    private readonly reviewRulesService: ReviewRulesService,
  ) { }

  // GET /pull-requests?platform=GITHUB&forceSync=true
  // Triggers a background sync against connected providers if the cached
  // data is stale (see PR_SYNC_STALE_MINUTES) before returning results.
  @ApiOperation({
    summary: 'List the authenticated user\'s pull requests, optionally filtered by platform',
    description:
      'Syncs from GitHub/GitLab first if the cached data is older than PR_SYNC_STALE_MINUTES. ' +
      'Pass forceSync=true to sync immediately regardless of staleness (e.g. right after creating a new PR).',
  })
  @ApiQuery({ name: 'platform', required: false, enum: ['GITHUB', 'GITLAB'], description: 'Filter by platform' })
  @ApiQuery({ name: 'forceSync', required: false, type: Boolean, description: 'Bypass the staleness check and sync now' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-indexed, default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20, max 100)' })
  @ApiResponse({ status: 200, description: 'Paginated list of pull requests retrieved successfully' })
  @Get()
  async findAll(@CurrentUser() user: IUser, @Query() query: PullRequestQueryDto) {
    const { items, total } = await this.pullRequestsService.findAllForUser(
      user.id,
      query.platform as Platform | undefined,
      query.forceSync,
      query.page,
      query.limit,
    );
    return { pullRequests: items, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  // GET /pull-requests/by-repository?platform=GITHUB&forceSync=true
  // Same underlying data as GET /pull-requests, grouped by repository instead
  // of one flat list. Registered before GET /pull-requests/:id so "by-repository"
  // is never swallowed as an :id.
  @ApiOperation({
    summary: "List the authenticated user's pull requests grouped by repository",
    description:
      'Same sync-then-fetch behavior as GET /pull-requests, but grouped by repository. Repositories are ' +
      'ordered by their own most recently updated pull request (latest-active repo first); pull requests ' +
      'within each repository are also latest first. Pagination (page/limit) applies to the list of ' +
      'repositories — every pull request for a repository on the current page is included, uncapped.',
  })
  @ApiQuery({ name: 'platform', required: false, enum: ['GITHUB', 'GITLAB'], description: 'Filter by platform' })
  @ApiQuery({ name: 'forceSync', required: false, type: Boolean, description: 'Bypass the staleness check and sync now' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Repository page number (1-indexed, default 1)', default: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Repositories per page (default 20, max 100)', default: 20 })
  @ApiResponse({ status: 200, description: 'Repositories with their pull requests retrieved successfully', type: RepositoryPullRequestsListResponseDto })
  @Get('by-repository')
  async findAllGroupedByRepository(@CurrentUser() user: IUser, @Query() query: PullRequestQueryDto) {
    const { items, total } = await this.pullRequestsService.findAllGroupedByRepository(
      user.id,
      query.platform as Platform | undefined,
      query.forceSync,
      query.page,
      query.limit,
    );
    return { repositories: items, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  // GET /pull-requests/:id
  @ApiOperation({ summary: 'Get a specific pull request by ID' })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Pull request retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Get(':id')
  async findOne(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.pullRequestsService.findOneForUser(user.id, id);
  }

  // GET /pull-requests/:id/reviews
  @ApiOperation({ summary: 'Get reviews for a specific pull request' })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully (empty array if none yet)' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Get(':id/reviews')
  async findReviews(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.reviewsService.getReviewsForPullRequest(user.id, id);
  }

  // POST /pull-requests/:id/ai-review
  @ApiOperation({
    summary: 'Generate an AI code review for a pull request and post it as a real GitHub review',
    description:
      'Fetches the PR diff, sends it to the configured AI provider, and posts the result back to ' +
      'GitHub as a COMMENT-type review (never auto-approves). GitHub-only for now.',
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 201, description: 'AI review generated and posted successfully' })
  @ApiResponse({ status: 400, description: 'Not a GitHub pull request, no connected GitHub account, or the PR has no diff to review' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @ApiResponse({ status: 503, description: 'The AI provider or GitHub API is temporarily unavailable' })
  @Post(':id/ai-review')
  async aiReview(@CurrentUser() user: IUser, @Param('id') id: string) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);

    if (pullRequest.platform !== Platform.GITHUB) {
      throw new BadRequestException('AI review is currently only supported for GitHub pull requests.');
    }

    const result = await this.aiReviewService.reviewGithubPullRequest(user.id, {
      repositoryFullName: pullRequest.repositoryFullName,
      number: pullRequest.number,
      title: pullRequest.title,
      description: pullRequest.description,
    });

    return { reviewed: true, ...result };
  }

  // POST /pull-requests/:id/repo-analysis
  @ApiOperation({
    summary: "Analyze this PR's repo and produce an onboarding assessment + suggested review config",
    description:
      'For projects taken over mid-way from another team/vendor, where the default review prompt would ' +
      'otherwise produce irrelevant findings. Produces a report plus a suggested project config; nothing is ' +
      'applied automatically — see POST :id/repo-analysis/apply.',
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 201, description: 'Repository analyzed successfully' })
  @ApiResponse({ status: 400, description: 'Not a GitHub pull request, or no connected GitHub account' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @ApiResponse({ status: 503, description: 'The AI provider or GitHub API is temporarily unavailable' })
  @Post(':id/repo-analysis')
  async analyzeRepository(@CurrentUser() user: IUser, @Param('id') id: string) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);

    if (pullRequest.platform !== Platform.GITHUB) {
      throw new BadRequestException('Repository analysis is currently only supported for GitHub repositories.');
    }

    return this.aiReviewService.analyzeGithubRepository(user.id, pullRequest.repositoryFullName);
  }

  // POST /pull-requests/:id/repo-analysis/apply
  @ApiOperation({
    summary: "Apply the latest repo analysis's suggested config to this repo's review config",
    description:
      'Explicit, separate confirm step — loads the most recent POST :id/repo-analysis result and writes its ' +
      'suggested architectureNotes/conventions/focusAreas/excludePatterns into the project config.',
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 201, description: 'Suggested config applied successfully' })
  @ApiResponse({ status: 400, description: 'No analysis found for this repo yet, or it has no suggested config' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Post(':id/repo-analysis/apply')
  async applyRepositoryAnalysis(@CurrentUser() user: IUser, @Param('id') id: string) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);
    return this.aiReviewService.applyRepositoryAssessmentConfig(user.id, pullRequest.repositoryFullName);
  }

  // GET /pull-requests/:id/rules
  @ApiOperation({
    summary: "List this PR's repo custom AI review rules",
    description:
      "Stored per (user, repo) and matched against each review's changed files, then injected into the AI review prompt.",
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Rules retrieved successfully (empty array if none configured)' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Get(':id/rules')
  async listRules(@CurrentUser() user: IUser, @Param('id') id: string) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);
    const rules = await this.reviewRulesService.listRules(user.id, pullRequest.repositoryFullName);
    return { rules };
  }

  // POST /pull-requests/:id/rules
  @ApiOperation({
    summary: "Add a custom AI review rule to this PR's repo",
    description:
      'Scope a rule to specific files with `pattern` (a glob matched against changed file paths), or omit it ' +
      'to apply the rule to every future review in this repo.',
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 201, description: 'Rule created successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Post(':id/rules')
  async addRule(@CurrentUser() user: IUser, @Param('id') id: string, @Body() dto: CreateReviewRuleDto) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);
    const rule = await this.reviewRulesService.addRule(user.id, pullRequest.repositoryFullName, dto);
    return { rule };
  }

  // GET /pull-requests/:id/project-config
  @ApiOperation({
    summary: "Get this PR's repo structured review config",
    description:
      'Architecture notes, conventions, focus areas, and exclude patterns — the dynamic, project-level ' +
      "review config, alongside this repo's rule list.",
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Config retrieved successfully (defaults if none configured yet)' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Get(':id/project-config')
  async getProjectConfig(@CurrentUser() user: IUser, @Param('id') id: string) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);
    return this.reviewRulesService.getConfig(user.id, pullRequest.repositoryFullName);
  }

  // PUT /pull-requests/:id/project-config
  @ApiOperation({
    summary: "Update this PR's repo structured review config",
    description:
      'Upserts architectureNotes/conventions/focusAreas/excludePatterns. Omitted fields are left unchanged; ' +
      'the rule list is managed separately via POST :id/rules.',
  })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Config updated successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found, or does not belong to the authenticated user' })
  @Put(':id/project-config')
  async updateProjectConfig(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectConfigDto,
  ) {
    const pullRequest = await this.pullRequestsService.getOwnedPullRequestOrThrow(user.id, id);
    return this.reviewRulesService.updateConfig(user.id, pullRequest.repositoryFullName, dto);
  }
}
