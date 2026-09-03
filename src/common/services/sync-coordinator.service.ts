import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { GithubService } from '@/github/github.service';
import { GitlabService } from '@/gitlab/gitlab.service';

/**
 * Central "sync if stale" gate used by every GET endpoint. Staleness is
 * derived from the most recent `lastSyncedAt` timestamp already stored on
 * the user's PullRequest rows — no extra table needed. A user with zero
 * synced PRs yet is always considered stale, which correctly forces the
 * first sync.
 *
 * Concurrency note: two simultaneous requests from the same user could both
 * see stale data and both trigger a sync. That's acceptable here since the
 * upserts are idempotent — worst case is a redundant round-trip to
 * GitHub/GitLab, never duplicate or corrupted data. If you want to fully
 * eliminate the redundant call, wrap this in a per-user Redis lock.
 */
@Injectable()
export class SyncCoordinatorService {
  private readonly logger = new Logger(SyncCoordinatorService.name);
  private readonly staleAfterMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly githubService: GithubService,
    private readonly gitlabService: GitlabService,
  ) {
    const minutes = Number(this.config.get('PR_SYNC_STALE_MINUTES') ?? 5);
    this.staleAfterMs = minutes * 60 * 1000;
  }

  /** Syncs GitHub and/or GitLab for this user if their data is stale. Always safe to call. */
  async ensureFresh(userId: string): Promise<void> {
    const isStale = await this.isDataStale(userId);
    if (!isStale) {
      this.logger.debug(`Data fresh for user ${userId}, skipping sync`);
      return;
    }

    // Run both providers concurrently; a failure connecting to one provider
    // must not block returning data synced from the other.
    const [githubResult, gitlabResult] = await Promise.allSettled([
      this.githubService.syncForUser(userId),
      this.gitlabService.syncForUser(userId),
    ]);

    if (githubResult.status === 'rejected') {
      this.logger.warn(`GitHub sync failed for user ${userId}: ${githubResult.reason}`);
    }
    if (gitlabResult.status === 'rejected') {
      this.logger.warn(`GitLab sync failed for user ${userId}: ${gitlabResult.reason}`);
    }

    // If BOTH providers are connected and BOTH failed, surface the error —
    // otherwise degrade gracefully and serve whatever is in the database.
    const bothConnected =
      githubResult.status === 'fulfilled' &&
      gitlabResult.status === 'fulfilled' &&
      githubResult.value === false &&
      gitlabResult.value === false;

    if (!bothConnected && githubResult.status === 'rejected' && gitlabResult.status === 'rejected') {
      throw githubResult.reason;
    }
  }

  private async isDataStale(userId: string): Promise<boolean> {
    const mostRecent = await this.prisma.pullRequest.findFirst({
      where: { userId },
      orderBy: { lastSyncedAt: 'desc' },
      select: { lastSyncedAt: true },
    });

    if (!mostRecent?.lastSyncedAt) return true;
    return Date.now() - mostRecent.lastSyncedAt.getTime() > this.staleAfterMs;
  }
}
