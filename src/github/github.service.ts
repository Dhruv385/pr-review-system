import { Injectable, Logger } from '@nestjs/common';
import { Platform, PullRequestStatus, ReviewState } from '@/common/interfaces/pr-review.interfaces';
import { PrismaService } from '@/database/prisma.service';
import { GithubAuthService } from './github-auth.service';
import { GithubApiClient, GithubPull, GithubReview } from './github-api.client';
import { mapWithConcurrency } from '@/common/utils/concurrency.util';
import { NormalizedPullRequest, NormalizedReview } from '@/common/interfaces/pr-review.interfaces';

const REVIEW_FETCH_CONCURRENCY = 5;

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAuth: GithubAuthService,
    private readonly githubApi: GithubApiClient,
  ) { }

  /**
   * Full sync for one user: repos -> PRs -> reviews -> upsert.
   * Returns false (no-op) if the user has no connected GitHub account.
   */
  async syncForUser(userId: string): Promise<boolean> {
    const accessToken = await this.githubAuth.getDecryptedToken(userId);
    if (!accessToken) return false;

    const repos = await this.githubApi.listAccessibleRepos(accessToken);

    // Repos processed with limited concurrency to respect rate limits.
    await mapWithConcurrency(repos, REVIEW_FETCH_CONCURRENCY, async (repo) => {
      const pulls = await this.githubApi.listPullRequests(accessToken, repo.full_name);

      await mapWithConcurrency(pulls, REVIEW_FETCH_CONCURRENCY, async (pull) => {
        const normalizedPr = this.normalizePullRequest(pull, repo);
        const savedPr = await this.upsertPullRequest(userId, normalizedPr);

        const reviews = await this.githubApi.listReviews(accessToken, repo.full_name, pull.number);
        const normalizedReviews = reviews
          .filter((r) => !!r.user) // skip reviews from deleted/ghost users
          .map((r) => this.normalizeReview(r));

        await this.upsertReviews(savedPr.id, normalizedReviews);
      });
    });

    this.logger.log(`GitHub sync complete for user ${userId}: ${repos.length} repos processed`);
    return true;
  }

  private normalizePullRequest(
    pull: GithubPull,
    repo: { id: number; name: string; full_name: string },
  ): NormalizedPullRequest {
    return {
      externalId: String(pull.id),
      platform: Platform.GITHUB,
      number: pull.number,
      title: pull.title,
      description: pull.body,
      repositoryId: String(repo.id),
      repositoryName: repo.name,
      repositoryFullName: repo.full_name,
      status: pull.merged_at ? PullRequestStatus.MERGED : pull.state === 'open' ? PullRequestStatus.OPEN : PullRequestStatus.CLOSED,
      authorName: pull.user?.login ?? 'unknown',
      url: pull.html_url,
    };
  }

  private normalizeReview(review: GithubReview): NormalizedReview {
    const stateMap: Record<GithubReview['state'], ReviewState> = {
      APPROVED: ReviewState.APPROVED,
      CHANGES_REQUESTED: ReviewState.CHANGES_REQUESTED,
      COMMENTED: ReviewState.COMMENTED,
      PENDING: ReviewState.PENDING,
      DISMISSED: ReviewState.DISMISSED,
    };
    return {
      externalId: String(review.id),
      reviewerName: review.user!.login,
      reviewerAvatarUrl: review.user!.avatar_url ?? null,
      state: stateMap[review.state] ?? ReviewState.COMMENTED,
      comment: review.body,
      submittedAt: review.submitted_at ? new Date(review.submitted_at) : null,
    };
  }

  private async upsertPullRequest(userId: string, pr: NormalizedPullRequest) {
    return this.prisma.pullRequest.upsert({
      where: {
        userId_platform_externalId: {
          userId,
          platform: pr.platform,
          externalId: pr.externalId,
        },
      },
      create: { ...pr, userId, lastSyncedAt: new Date() },
      update: { ...pr, lastSyncedAt: new Date() },
    });
  }

  private async upsertReviews(pullRequestId: string, reviews: NormalizedReview[]) {
    if (reviews.length === 0) return;
    // Sequential upserts inside a transaction keep this atomic per-PR without
    // needing per-review concurrency (review counts per PR are small).
    await this.prisma.$transaction(
      reviews.map((review) =>
        this.prisma.review.upsert({
          where: {
            pullRequestId_externalId: {
              pullRequestId,
              externalId: review.externalId,
            },
          },
          create: { ...review, pullRequestId },
          update: { ...review },
        }),
      ),
    );
  }
}
