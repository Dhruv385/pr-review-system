import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { mapProviderError } from '@/common/exceptions/provider.exceptions';

export interface GitlabProject {
  id: number;
  name: string;
  path_with_namespace: string;
}

export interface GitlabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  web_url: string;
  author: { username: string } | null;
}

export interface GitlabApproval {
  user: { username: string; avatar_url: string };
}

export interface GitlabNote {
  id: number;
  author: { username: string; avatar_url: string } | null;
  body: string;
  system: boolean;
  created_at: string;
}

const GITLAB_API_BASE = 'https://gitlab.com/api/v4';
const PAGE_SIZE = 50;

/** Thin wrapper around the GitLab REST API — HTTP + pagination only. */
@Injectable()
export class GitlabApiClient {
  private readonly logger = new Logger(GitlabApiClient.name);

  constructor(private readonly http: HttpService) { }

  private axiosConfig(accessToken: string) {
    return {
      baseURL: GITLAB_API_BASE,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    };
  }

  async getAuthenticatedUser(accessToken: string): Promise<{ id: number; username: string }> {
    try {
      const { data } = await firstValueFrom(this.http.get('/user', this.axiosConfig(accessToken)));
      return { id: data.id, username: data.username };
    } catch (err) {
      mapProviderError(err, 'GitLab');
    }
  }

  async listAccessibleProjects(accessToken: string): Promise<GitlabProject[]> {
    return this.paginate<GitlabProject>(accessToken, '/projects', {
      membership: true,
      per_page: PAGE_SIZE,
      order_by: 'last_activity_at',
    });
  }

  async listMergeRequests(accessToken: string, projectId: number): Promise<GitlabMergeRequest[]> {
    return this.paginate<GitlabMergeRequest>(accessToken, `/projects/${projectId}/merge_requests`, {
      state: 'all',
      per_page: PAGE_SIZE,
      order_by: 'updated_at',
      sort: 'desc',
    });
  }

  async getApprovals(accessToken: string, projectId: number, mrIid: number): Promise<GitlabApproval[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(
          `/projects/${projectId}/merge_requests/${mrIid}/approvals`,
          this.axiosConfig(accessToken),
        ),
      );
      return data.approved_by ?? [];
    } catch (err) {
      // Approvals endpoint is a paid-tier feature on some GitLab plans / self-managed
      // instances without it enabled — degrade gracefully instead of failing the sync.
      this.logger.warn(`GitLab approvals unavailable for MR ${mrIid} on project ${projectId}`);
      return [];
    }
  }

  async listNotes(accessToken: string, projectId: number, mrIid: number): Promise<GitlabNote[]> {
    return this.paginate<GitlabNote>(
      accessToken,
      `/projects/${projectId}/merge_requests/${mrIid}/notes`,
      { per_page: PAGE_SIZE },
    );
  }

  private async paginate<T>(
    accessToken: string,
    path: string,
    params: Record<string, unknown>,
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    const MAX_PAGES = 20;

    while (page <= MAX_PAGES) {
      try {
        const { data, headers } = await firstValueFrom(
          this.http.get(path, {
            ...this.axiosConfig(accessToken),
            params: { ...params, page },
          }),
        );

        this.warnIfRateLimitLow(headers);

        if (!Array.isArray(data) || data.length === 0) break;
        results.push(...data);

        const nextPage = headers['x-next-page'];
        if (!nextPage) break;
        page = Number(nextPage);
      } catch (err) {
        mapProviderError(err, 'GitLab');
      }
    }

    return results;
  }

  private warnIfRateLimitLow(headers: Record<string, unknown> | undefined): void {
    const raw = headers?.['ratelimit-remaining'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const remaining = Number(value ?? 0);
    if (!Number.isNaN(remaining) && remaining < 5) {
      this.logger.warn(`GitLab rate limit nearly exhausted: ${remaining} requests remaining`);
    }
  }
}
