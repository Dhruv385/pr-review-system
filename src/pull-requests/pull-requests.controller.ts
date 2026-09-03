import { BadRequestException, Controller, Get, Inject, forwardRef, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard'; // adjust to your existing guard's path
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IUser, Platform } from '@/common/interfaces/pr-review.interfaces';
import { PullRequestsService } from './pull-requests.service';
import { ReviewsService } from '@/reviews/reviews.service';
import { AiReviewService } from '@/ai-review/ai-review.service';

@ApiTags('Pull Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pull-requests')
export class PullRequestsController {
  constructor(
    private readonly pullRequestsService: PullRequestsService,
    @Inject(forwardRef(() => ReviewsService))
    private readonly reviewsService: ReviewsService,
    private readonly aiReviewService: AiReviewService,
  ) { }

  // GET /pull-requests
  @ApiOperation({ summary: 'Get all pull requests for the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of pull requests retrieved successfully' })
  @Get()
  async findAll(@CurrentUser() user: IUser) {
    const pullRequests = await this.pullRequestsService.findAllForUser(user.id);
    return { pullRequests };
  }

  // GET /pull-requests/:id
  @ApiOperation({ summary: 'Get a specific pull request by ID' })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Pull request retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found' })
  @Get(':id')
  async findOne(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.pullRequestsService.findOneForUser(user.id, id);
  }

  // GET /pull-requests/:id/reviews
  @ApiOperation({ summary: 'Get reviews for a specific pull request' })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found' })
  @Get(':id/reviews')
  async findReviews(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.reviewsService.getReviewsForPullRequest(user.id, id);
  }

  // POST /pull-requests/:id/ai-review
  @ApiOperation({ summary: 'Generate an AI code review for a pull request and post it to GitHub' })
  @ApiParam({ name: 'id', description: 'Pull request ID' })
  @ApiResponse({ status: 201, description: 'AI review generated and posted successfully' })
  @ApiResponse({ status: 404, description: 'Pull request not found' })
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
    });

    return { reviewed: true, ...result };
  }
}
