import { BadRequestException, Controller, Get, Inject, forwardRef, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@guards/jwt';
import { CurrentUser } from '@decorators/current-user.decorator';
import { IUser, Platform } from '@app/interfaces/pr-review.interfaces';
import { PullRequestsService } from './pull-requests.service';
import { ReviewsService } from '@api/reviews/reviews.service';
import { AiReviewService } from '@api/ai-review/ai-review.service';
import { PullRequestQueryDto } from './dto/pull-request-query.dto';
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
}
