import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Platform, PullRequestStatus, ReviewState } from '@app/interfaces/pr-review.interfaces';
import { PrismaService } from '@shared/database/prisma.service';
import { GitlabAuthService } from './gitlab-auth.service';
import {
  GitlabApiClient,
  GitlabApproval,
  GitlabMergeRequest,
  GitlabNote,
} from './gitlab-api.client';
import { mapWithConcurrency } from '@utils/concurrency.util';
import { NormalizedPullRequest, NormalizedReview } from '@app/interfaces/pr-review.interfaces';

const MR_FETCH_CONCURRENCY = 5;

/**
 * GitLab has no single "review" object like GitHub — we normalize:
 *   - each approval -> a Review with state APPROVED
 *   - each non-system note -> a Review with state COMMENTED
 * so the internal Review model stays provider-agnostic.
 */
@Injectable()
export class GitlabService {
  private readonly logger = new Logger(GitlabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitlabAuth: GitlabAuthService,
    private readonly gitlabApi: GitlabApiClient,
  ) { }

  async syncForUser(userId: string): Promise<boolean> {
    const accessToken = await this.gitlabAuth.getDecryptedToken(userId);
    if (!accessToken) return false;

    try {
      await this.runSync(userId, accessToken);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        // Token is dead (revoked/expired) — stop hammering GitLab's API on
        // every subsequent request until the user reconnects their account.
        await this.prisma.gitlabAccount.update({ where: { userId }, data: { tokenRevoked: true } });
      }
      throw err;
    }

    return true;
  }

  private async runSync(userId: string, accessToken: string): Promise<void> {
    const projects = await this.gitlabApi.listAccessibleProjects(accessToken);

    await mapWithConcurrency(projects, MR_FETCH_CONCURRENCY, async (project) => {
      const mrs = await this.gitlabApi.listMergeRequests(accessToken, project.id);

      await mapWithConcurrency(mrs, MR_FETCH_CONCURRENCY, async (mr) => {
        const normalizedMr = this.normalizeMergeRequest(mr, project);
        const savedPr = await this.upsertPullRequest(userId, normalizedMr);

        const [approvals, notes] = await Promise.all([
          this.gitlabApi.getApprovals(accessToken, project.id, mr.iid),
          this.gitlabApi.listNotes(accessToken, project.id, mr.iid),
        ]);

        const normalizedReviews = [
          ...approvals.map((a) => this.normalizeApproval(mr.id, a)),
          ...notes.filter((n) => !n.system && n.author).map((n) => this.normalizeNote(n)),
        ];

        await this.upsertReviews(savedPr.id, normalizedReviews);
      });
    });

    this.logger.log(`GitLab sync complete for user ${userId}: ${projects.length} projects processed`);
  }

  private normalizeMergeRequest(
    mr: GitlabMergeRequest,
    project: { id: number; name: string; path_with_namespace: string },
  ): NormalizedPullRequest {
    const statusMap: Record<GitlabMergeRequest['state'], PullRequestStatus> = {
      opened: PullRequestStatus.OPEN,
      merged: PullRequestStatus.MERGED,
      closed: PullRequestStatus.CLOSED,
      locked: PullRequestStatus.OPEN,
    };
    return {
      externalId: String(mr.id),
      platform: Platform.GITLAB,
      number: mr.iid,
      title: mr.title,
      description: mr.description,
      repositoryId: String(project.id),
      repositoryName: project.name,
      repositoryFullName: project.path_with_namespace,
      status: statusMap[mr.state] ?? PullRequestStatus.OPEN,
      authorName: mr.author?.username ?? 'unknown',
      url: mr.web_url,
    };
  }

  // Approvals have no stable id from the API, so we derive one from MR id + username —
  // deterministic across syncs, which is what the unique constraint needs.
  private normalizeApproval(mrId: number, approval: GitlabApproval): NormalizedReview {
    return {
      externalId: `approval-${mrId}-${approval.user.username}`,
      reviewerName: approval.user.username,
      reviewerAvatarUrl: approval.user.avatar_url ?? null,
      state: ReviewState.APPROVED,
      comment: null,
      submittedAt: null,
    };
  }

  private normalizeNote(note: GitlabNote): NormalizedReview {
    return {
      externalId: `note-${note.id}`,
      reviewerName: note.author!.username,
      reviewerAvatarUrl: note.author!.avatar_url ?? null,
      state: ReviewState.COMMENTED,
      comment: note.body,
      submittedAt: new Date(note.created_at),
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
