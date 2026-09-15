import { Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Platform } from '@app/interfaces/pr-review.interfaces';
import { PrismaService } from '@shared/database/prisma.service';
import { SyncCoordinatorService } from '@api/sync/sync-coordinator.service';
import { PullRequestResponseDto } from './dto/pull-request-response.dto';
import { RepositoryPullRequestsDto } from './dto/repository-pull-requests-response.dto';

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

  /**
   * Same data as findAllForUser, grouped by repository instead of one flat
   * list. Repos are ordered by their own most recent PR (latest-active repo
   * first); PRs within a repo are latest-first too. There's no separate
   * Repository table, so grouping happens in-memory: pulling every matching
   * PR in a single updatedAt-desc query means the first PR encountered per
   * repositoryFullName is automatically that repo's latest, and the order
   * repos are first seen in is automatically the desc-by-latest-PR order —
   * no second sort needed. Pagination applies to the list of repositories,
   * not to PRs within each one (every PR for a repo is included).
   */
  async findAllGroupedByRepository(
    userId: string,
    platform?: Platform,
    forceSync = false,
    page = 1,
    limit = 20,
  ): Promise<{ items: RepositoryPullRequestsDto[]; total: number }> {
    await this.syncCoordinator.ensureFresh(userId, forceSync);

    const where = { userId, ...(platform ? { platform } : {}) };
    const pullRequests = await this.prisma.pullRequest.findMany({
      where,
      include: { _count: { select: { reviews: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    const byRepo = new Map<string, { repositoryName: string; platform: Platform; pullRequests: typeof pullRequests }>();
    for (const pr of pullRequests) {
      const group = byRepo.get(pr.repositoryFullName);
      if (group) {
        group.pullRequests.push(pr);
      } else {
        byRepo.set(pr.repositoryFullName, { repositoryName: pr.repositoryName, platform: pr.platform as Platform, pullRequests: [pr] });
      }
    }

    const allRepos = [...byRepo.entries()];
    const total = allRepos.length;
    const paged = allRepos.slice((page - 1) * limit, (page - 1) * limit + limit);

    // A plain object literal matches RepositoryPullRequestsDto's shape for
    // Swagger's sake; only the inner PullRequestResponseDto items need
    // plainToInstance, since that's what actually reshapes Prisma fields
    // (repositoryFullName -> repository, _count.reviews -> reviewCount, etc).
    const items: RepositoryPullRequestsDto[] = paged.map(([repositoryFullName, group]) => ({
      repositoryFullName,
      repositoryName: group.repositoryName,
      platform: group.platform,
      pullRequests: plainToInstance(PullRequestResponseDto, group.pullRequests, { excludeExtraneousValues: true }),
    }));

    return { items, total };
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
