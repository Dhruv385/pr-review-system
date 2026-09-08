import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { mapProviderError } from '@app/exceptions/provider.exceptions';

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
}

export interface GithubPull {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged_at: string | null;
  html_url: string;
  user: { login: string } | null;
}

export interface GithubReview {
  id: number;
  user: { login: string; avatar_url: string } | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  body: string | null;
  submitted_at: string | null;
}

const GITHUB_API_BASE = 'https://api.github.com';
const PAGE_SIZE = 50;

/**
 * Thin wrapper around the GitHub REST API. Only handles HTTP + pagination +
 * rate-limit-aware backoff. Normalization into internal models happens in
 * GithubService, keeping provider-specific shapes out of the rest of the app.
 */
@Injectable()
export class GithubApiClient {
  private readonly logger = new Logger(GithubApiClient.name);

  constructor(private readonly http: HttpService) { }

  async getAuthenticatedUser(accessToken: string): Promise<{ id: number; login: string }> {
    try {
      const { data } = await firstValueFrom(this.http.get('/user', this.axiosConfig(accessToken)));
      return { id: data.id, login: data.login };
    } catch (err) {
      mapProviderError(err, 'GitHub');
    }
  }

  private axiosConfig(accessToken: string, accept = 'application/vnd.github+json') {
    return {
      baseURL: GITHUB_API_BASE,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 15_000,
    };
  }

  /** Repos the authenticated user has push/pull access to (paginated, all pages). */
  async listAccessibleRepos(accessToken: string): Promise<GithubRepo[]> {
    return this.paginate<GithubRepo>(accessToken, '/user/repos', {
      affiliation: 'owner,collaborator,organization_member',
      per_page: PAGE_SIZE,
      sort: 'updated',
    });
  }

  /** Open + recently updated PRs authored by or assigned to the user in a given repo. */
  async listPullRequests(accessToken: string, fullName: string): Promise<GithubPull[]> {
    return this.paginate<GithubPull>(accessToken, `/repos/${fullName}/pulls`, {
      state: 'all',
      per_page: PAGE_SIZE,
      sort: 'updated',
      direction: 'desc',
    });
  }

  async listReviews(accessToken: string, fullName: string, prNumber: number): Promise<GithubReview[]> {
    return this.paginate<GithubReview>(
      accessToken,
      `/repos/${fullName}/pulls/${prNumber}/reviews`,
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
    // GitHub caps at ~100 pages worth of practical use here; hard-stop to avoid runaway loops.
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
        if (data.length < (params.per_page as number)) break; // last page
        page += 1;
      } catch (err) {
        mapProviderError(err, 'GitHub');
      }
    }

    return results;
  }

  /** Raw unified diff for a PR — used as the input for AI review generation. */
  async getPullRequestDiff(accessToken: string, fullName: string, prNumber: number): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<string>(`/repos/${fullName}/pulls/${prNumber}`, {
          ...this.axiosConfig(accessToken, 'application/vnd.github.v3.diff'),
          responseType: 'text',
          transformResponse: (res) => res, // keep the raw diff text, skip JSON parsing
        }),
      );
      return data;
    } catch (err) {
      mapProviderError(err, 'GitHub');
    }
  }

  /** Posts a review (AI-generated or otherwise) on a PR under the connected account's identity. */
  async submitReview(
    accessToken: string,
    fullName: string,
    prNumber: number,
    review: { body: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' },
  ): Promise<{ id: number; html_url: string }> {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `/repos/${fullName}/pulls/${prNumber}/reviews`,
          { body: review.body, event: review.event },
          this.axiosConfig(accessToken),
        ),
      );
      return { id: data.id, html_url: data.html_url };
    } catch (err) {
      mapProviderError(err, 'GitHub');
    }
  }

  private warnIfRateLimitLow(headers: Record<string, unknown> | undefined): void {
    const raw = headers?.['x-ratelimit-remaining'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const remaining = Number(value ?? 0);
    if (!Number.isNaN(remaining) && remaining < 5) {
      this.logger.warn(`GitHub rate limit nearly exhausted: ${remaining} requests remaining`);
    }
  }
}
