import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AiReviewRating, Platform, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@shared/database/prisma.service';
import { SyncCoordinatorService } from '@api/sync/sync-coordinator.service';
import { AI_REVIEW_MARKER } from '@api/ai-review/ai-review.service';
import { PullRequestResponseDto } from '@api/pull-requests/dto/pull-request-response.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { SubmitReviewFeedbackDto } from './dto/submit-review-feedback.dto';

export interface AccuracySummary {
  total: number;
  accurate: number;
  partiallyAccurate: number;
  inaccurate: number;
  accuracyPercent: number;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncCoordinator: SyncCoordinatorService,
  ) { }

  /** GET /pull-requests/:id/reviews — syncs (if stale) then returns PR + its reviews. */
  async getReviewsForPullRequest(userId: string, pullRequestId: string) {
    // Ownership check FIRST, before touching any provider API, so a user can
    // never trigger a sync side-effect for a PR they don't own.
    const ownedPullRequest = await this.prisma.pullRequest.findFirst({
      where: { id: pullRequestId, userId },
      select: { id: true },
    });
    if (!ownedPullRequest) {
      throw new NotFoundException('Pull request not found');
    }
    await this.syncCoordinator.ensureFresh(userId);

    const pullRequest = await this.prisma.pullRequest.findFirst({
      where: { id: pullRequestId, userId },
      include: { reviews: { orderBy: { submittedAt: 'desc' } } },
    });

    if (!pullRequest) {
      throw new NotFoundException('Pull request not found');
    }

    return {
      pullRequest: plainToInstance(
        PullRequestResponseDto,
        { ...pullRequest, _count: { reviews: pullRequest.reviews.length } },
        { excludeExtraneousValues: true },
      ),
      reviews: plainToInstance(ReviewResponseDto, pullRequest.reviews, {
        excludeExtraneousValues: true,
      }),
    };
  }

  /** GET /reviews — all reviews owned by the user, optionally filtered by platform. */
  async findAllForUser(
    userId: string,
    platform?: Platform,
    page = 1,
    limit = 20,
  ): Promise<{ items: ReviewResponseDto[]; total: number }> {
    const where = {
      pullRequest: {
        userId, // ownership enforced through the PullRequest relation
        ...(platform ? { platform } : {}),
      },
    };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: plainToInstance(ReviewResponseDto, reviews, { excludeExtraneousValues: true }),
      total,
    };
  }

  /** GET /reviews/:reviewId/pull-request */
  async getPullRequestForReview(userId: string, reviewId: string): Promise<PullRequestResponseDto> {
    const review = await this.prisma.review.findFirst({
      where: {
        id: reviewId,
        pullRequest: { userId }, // ownership via the PullRequest relation, not the review itself
      },
      include: { pullRequest: { include: { _count: { select: { reviews: true } } } } },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    return plainToInstance(PullRequestResponseDto, review.pullRequest, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * POST /reviews/:reviewId/feedback — one rating (+ optional note) per
   * (user, review), re-ratable via upsert. Only valid for the AI's own
   * posted reviews (identified by AI_REVIEW_MARKER in `comment`) — feedback
   * on a human review wouldn't measure anything this feature cares about.
   */
  async submitFeedback(userId: string, reviewId: string, dto: SubmitReviewFeedbackDto) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, pullRequest: { userId } }, // ownership via the PullRequest relation
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (!review.comment?.includes(AI_REVIEW_MARKER)) {
      throw new BadRequestException('Feedback can only be submitted for AI-generated reviews.');
    }

    return this.prisma.aiReviewFeedback.upsert({
      where: { userId_reviewId: { userId, reviewId } },
      create: { userId, reviewId, rating: dto.rating, notes: dto.notes ?? null },
      update: { rating: dto.rating, notes: dto.notes ?? null },
    });
  }

  /**
   * GET /reviews/accuracy — aggregate feedback ratings into a percentage,
   * scoped to the user's own feedback and optionally narrowed to one repo/
   * platform. accuracyPercent = accurate / total * 100 — kept simple and
   * transparent rather than inventing a weighting for partial matches.
   */
  async getAccuracy(
    userId: string,
    filters: { repositoryFullName?: string; platform?: Platform } = {},
  ): Promise<AccuracySummary> {
    const where: Prisma.AiReviewFeedbackWhereInput = {
      userId,
      ...(filters.repositoryFullName || filters.platform
        ? {
            review: {
              pullRequest: {
                ...(filters.repositoryFullName ? { repositoryFullName: filters.repositoryFullName } : {}),
                ...(filters.platform ? { platform: filters.platform } : {}),
              },
            },
          }
        : {}),
    };

    const grouped = await this.prisma.aiReviewFeedback.groupBy({
      by: ['rating'],
      where,
      _count: { _all: true },
    });

    const counts: Record<AiReviewRating, number> = { ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 };
    for (const group of grouped) counts[group.rating] = group._count._all;

    const total = counts.ACCURATE + counts.PARTIALLY_ACCURATE + counts.INACCURATE;
    return {
      total,
      accurate: counts.ACCURATE,
      partiallyAccurate: counts.PARTIALLY_ACCURATE,
      inaccurate: counts.INACCURATE,
      accuracyPercent: total ? Math.round((counts.ACCURATE / total) * 1000) / 10 : 0,
    };
  }
}
