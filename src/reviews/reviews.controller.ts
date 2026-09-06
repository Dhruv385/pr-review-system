import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Platform } from '@/common/interfaces/pr-review.interfaces';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IUser } from '@/common/interfaces/pr-review.interfaces';
import { ReviewsService } from './reviews.service';
import { ReviewQueryDto } from './dto/review-query.dto';

@ApiTags('Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) { }

  // GET /reviews?platform=GITHUB
  @ApiOperation({ summary: 'Get all reviews for the authenticated user, optionally filtered by platform' })
  @ApiQuery({ name: 'platform', required: false, enum: ['GITHUB', 'GITLAB'], description: 'Filter by platform' })
  @ApiResponse({ status: 200, description: 'Reviews retrieved successfully (empty array if none match)' })
  @Get()
  async findAll(@CurrentUser() user: IUser, @Query() query: ReviewQueryDto) {
    const reviews = await this.reviewsService.findAllForUser(
      user.id,
      query.platform as Platform | undefined,
    );
    return { reviews };
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
}
