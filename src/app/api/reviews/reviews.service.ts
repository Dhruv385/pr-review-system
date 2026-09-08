import { Injectable, NotFoundException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@shared/database/prisma.service';
import { SyncCoordinatorService } from '@api/sync/sync-coordinator.service';
import { PullRequestResponseDto } from '@api/pull-requests/dto/pull-request-response.dto';
import { ReviewResponseDto } from './dto/review-response.dto';

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
}
