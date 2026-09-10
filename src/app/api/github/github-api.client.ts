import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { mapProviderError } from '@app/exceptions/provider.exceptions';

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
}

export interface GithubRepoDetails {
  full_name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  default_branch: string;
}

export interface GithubPullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GithubFileMeta {
  content: string;
  sha: string;
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

  /**
   * Full recursive file listing (paths only) at a ref — used to sniff the
   * project's folder layout and architectural conventions for AI review
   * context. GitHub silently truncates the response for very large repos
   * (`truncated: true`); that's fine here, a partial listing is still useful signal.
   */
  async getRepoTree(accessToken: string, fullName: string, ref: string): Promise<string[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/repos/${fullName}/git/trees/${ref}`, {
          ...this.axiosConfig(accessToken),
          params: { recursive: 1 },
        }),
      );
      const tree = Array.isArray(data.tree) ? data.tree : [];
      return tree
        .filter((entry: { type: string }) => entry.type === 'blob')
        .map((entry: { path: string }) => entry.path);
    } catch (err) {
      mapProviderError(err, 'GitHub');
    }
  }

  /** Repo metadata (language, description, default branch) — used to give the AI reviewer project context. */
  async getRepoDetails(accessToken: string, fullName: string): Promise<GithubRepoDetails> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/repos/${fullName}`, this.axiosConfig(accessToken)),
      );
      return {
        full_name: data.full_name,
        description: data.description ?? null,
        language: data.language ?? null,
        topics: Array.isArray(data.topics) ? data.topics : [],
        default_branch: data.default_branch,
      };
    } catch (err) {
      mapProviderError(err, 'GitHub');
    }
  }

  /** Filenames + change stats for a PR — gives the reviewer the full change scope even when the diff itself is truncated. */
  async listPullRequestFiles(accessToken: string, fullName: string, prNumber: number): Promise<GithubPullFile[]> {
    return this.paginate<GithubPullFile>(accessToken, `/repos/${fullName}/pulls/${prNumber}/files`, {
      per_page: PAGE_SIZE,
    });
  }

  /**
   * Content + blob sha of a file at a given ref, or null if it doesn't exist.
   * The sha is required by the Contents API to update an existing file —
   * best-effort lookup (e.g. package.json, README, review rules), so a
   * missing file is a normal outcome here, not an error: 404s resolve to
   * null instead of throwing.
   */
  async getFileMeta(accessToken: string, fullName: string, path: string, ref?: string): Promise<GithubFileMeta | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/repos/${fullName}/contents/${path}`, {
          ...this.axiosConfig(accessToken),
          params: ref ? { ref } : undefined,
        }),
      );
      if (Array.isArray(data) || data.type !== 'file' || !data.content) return null;
      return {
        content: Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8'),
        sha: data.sha,
      };
    } catch (err) {
      if ((err as AxiosError)?.response?.status === 404) return null;
      mapProviderError(err, 'GitHub');
    }
  }

  /** Raw text content of a file at a given ref, or null if it doesn't exist. */
  async getFileContent(accessToken: string, fullName: string, path: string, ref?: string): Promise<string | null> {
    const meta = await this.getFileMeta(accessToken, fullName, path, ref);
    return meta?.content ?? null;
  }

  /**
   * Creates or updates a file's content on a branch via the Contents API,
   * committed under the connected account's own identity — used to persist
   * review rules back into the target repo. Pass `sha` (from getFileMeta)
   * when updating an existing file; omit it to create a new one.
   */
  async upsertFileContent(
    accessToken: string,
    fullName: string,
    path: string,
    content: string,
    message: string,
    options: { sha?: string; branch?: string } = {},
  ): Promise<{ sha: string }> {
    try {
      const { data } = await firstValueFrom(
        this.http.put(
          `/repos/${fullName}/contents/${path}`,
          {
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            sha: options.sha,
            branch: options.branch,
          },
          this.axiosConfig(accessToken),
        ),
      );
      return { sha: data.content.sha };
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
