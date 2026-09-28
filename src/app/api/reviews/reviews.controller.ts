import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Platform } from '@app/interfaces/pr-review.interfaces';
import { JwtAuthGuard } from '@guards/jwt';
import { CurrentUser } from '@decorators/current-user.decorator';
import { IUser } from '@app/interfaces/pr-review.interfaces';
import { ReviewsService } from './reviews.service';
import { ReviewQueryDto } from './dto/review-query.dto';
import { SubmitReviewFeedbackDto } from './dto/submit-review-feedback.dto';
import { AccuracyQueryDto } from './dto/accuracy-query.dto';
import { buildPaginationMeta } from '@utils/pagination.util';

@ApiTags('Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) { }

  // GET /reviews?platform=GITHUB&page=1&limit=20
  @ApiOperation({ summary: 'Get all reviews for the authenticated user, optionally filtered by platform' })
  @ApiQuery({ name: 'platform', required: false, enum: ['GITHUB', 'GITLAB'], description: 'Filter by platform' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-indexed, default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20, max 100)' })
  @ApiResponse({ status: 200, description: 'Paginated reviews retrieved successfully (empty array if none match)' })
  @Get()
  async findAll(@CurrentUser() user: IUser, @Query() query: ReviewQueryDto) {
    const { items, total } = await this.reviewsService.findAllForUser(
      user.id,
      query.platform as Platform | undefined,
      query.page,
      query.limit,
    );
    return { reviews: items, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  // GET /reviews/:reviewId/pull-request
  @ApiOperation({ summary: 'Get the pull request associated with a review' })
  @ApiParam({ name: 'reviewId', description: 'Review ID' })
  @ApiResponse({ status: 200, description: 'Pull request retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Review not found, or does not belong to the authenticated user' })
  @Get(':reviewId/pull-request')
  async getPullRequest(@CurrentUser() user: IUser, @Param('reviewId') reviewId: string) {
    return this.reviewsService.getPullRequestForReview(user.id, reviewId);
  }

  // GET /reviews/accuracy?repositoryFullName=owner/repo&platform=GITHUB
  // Registered before :reviewId/pull-request-shaped routes are relevant so
  // "accuracy" is never swallowed as a :reviewId.
  @ApiOperation({
    summary: 'Get the accuracy percentage of AI-generated reviews, optionally scoped to one repo/platform',
    description: 'Aggregates feedback submitted via POST :reviewId/feedback. accuracyPercent = accurate / total * 100.',
  })
  @ApiQuery({ name: 'repositoryFullName', required: false, description: 'Narrow to one repository, e.g. "owner/repo"' })
  @ApiQuery({ name: 'platform', required: false, enum: ['GITHUB', 'GITLAB'], description: 'Narrow to one platform' })
  @ApiResponse({ status: 200, description: 'Accuracy summary retrieved successfully (zeros if no feedback yet)' })
  @Get('accuracy')
  async getAccuracy(@CurrentUser() user: IUser, @Query() query: AccuracyQueryDto) {
    return this.reviewsService.getAccuracy(user.id, {
      repositoryFullName: query.repositoryFullName,
      platform: query.platform as Platform | undefined,
    });
  }

  // POST /reviews/:reviewId/feedback
  @ApiOperation({
    summary: 'Rate the accuracy of an AI-generated review',
    description:
      'One rating (+ optional note) per (user, review) — resubmitting overwrites the previous rating. ' +
      'Only valid for AI-generated reviews.',
  })
  @ApiParam({ name: 'reviewId', description: 'Review ID' })
  @ApiResponse({ status: 201, description: 'Feedback recorded successfully' })
  @ApiResponse({ status: 400, description: 'This review was not AI-generated' })
  @ApiResponse({ status: 404, description: 'Review not found, or does not belong to the authenticated user' })
  @Post(':reviewId/feedback')
  async submitFeedback(
    @CurrentUser() user: IUser,
    @Param('reviewId') reviewId: string,
    @Body() dto: SubmitReviewFeedbackDto,
  ) {
    const feedback = await this.reviewsService.submitFeedback(user.id, reviewId, dto);
    return { feedback };
  }
}
