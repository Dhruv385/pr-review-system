import { Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Platform } from '@/common/interfaces/pr-review.interfaces';
import { PrismaService } from '@/database/prisma.service';
import { SyncCoordinatorService } from '@/common/services/sync-coordinator.service';
import { PullRequestResponseDto } from './dto/pull-request-response.dto';

@Injectable()
export class PullRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncCoordinator: SyncCoordinatorService,
  ) { }

  async findAllForUser(
    userId: string,
    platform?: Platform,
    forceSync = false,
    page = 1,
    limit = 20,
  ): Promise<{ items: PullRequestResponseDto[]; total: number }> {
    await this.syncCoordinator.ensureFresh(userId, forceSync);

    const where = { userId, ...(platform ? { platform } : {}) }; // ownership enforced at the query level, always
    const [pullRequests, total] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where,
        include: { _count: { select: { reviews: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pullRequest.count({ where }),
    ]);

    return {
      items: plainToInstance(PullRequestResponseDto, pullRequests, { excludeExtraneousValues: true }),
      total,
    };
  }

  async findOneForUser(userId: string, pullRequestId: string): Promise<PullRequestResponseDto> {
    await this.syncCoordinator.ensureFresh(userId);

    const pullRequest = await this.prisma.pullRequest.findFirst({
      where: {
        id: pullRequestId,
        userId, // never trust an id alone — always scope to the authenticated user
      },
      include: { _count: { select: { reviews: true } } },
    });

    if (!pullRequest) {
      throw new NotFoundException('Pull request not found');
    }

    return plainToInstance(PullRequestResponseDto, pullRequest, {
      excludeExtraneousValues: true,
    });
  }

  /** Verifies ownership and returns the raw entity — used internally by ReviewsService too. */
  async getOwnedPullRequestOrThrow(userId: string, pullRequestId: string) {
    const pullRequest = await this.prisma.pullRequest.findFirst({
      where: { id: pullRequestId, userId },
    });
    if (!pullRequest) {
      throw new NotFoundException('Pull request not found');
    }
    return pullRequest;
  }
}
