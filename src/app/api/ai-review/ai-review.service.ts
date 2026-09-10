import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EnvService } from '@shared/env';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { GithubAuthService } from '@api/github/github-auth.service';
import { GithubApiClient, GithubPullFile } from '@api/github/github-api.client';
import { GithubService } from '@api/github/github.service';
import { ReviewRulesService, ReviewRule } from '@api/review-rules/review-rules.service';

// Read fresh from disk on every review (not cached in memory) so editing the
// wording is a content change, not a code change — no redeploy or restart
// needed to pick it up. `assets` in nest-cli.json copies this file next to
// the compiled service in dist/ on build.
const SYSTEM_PROMPT_PATH = join(__dirname, 'prompts', 'review-system-prompt.md');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b'; // free-tier on Groq — llama-3.3-70b-versatile is enterprise-only now
const MAX_COMPLETION_TOKENS = 4000;
// Groq's free tier caps at 8000 tokens/minute *total* (prompt + completion).
// Kept well under that with margin: ~4 chars/token for diff text, plus the
// system prompt, plus the project/PR context, plus MAX_COMPLETION_TOKENS
// reserved for the response. Trimmed down from the diff-only budget to make
// room for the context sections below.
const MAX_DIFF_CHARS = 10_000;
const MAX_DEPENDENCIES_LISTED = 15;
const MAX_FILES_LISTED = 30;
const MAX_DESCRIPTION_CHARS = 800;

interface PullRequestRef {
  repositoryFullName: string;
  number: number;
  title: string;
  description?: string | null;
}

export interface AiReviewResult {
  body: string;
  githubReviewUrl: string;
}

/**
 * Generates a code review with Groq (free-tier LLM API) and posts it back to
 * GitHub as a real PR review. The review is submitted under the connected
 * account's own OAuth token, so it appears as posted by that GitHub user —
 * GitHub has no concept of an anonymous "AI reviewer" identity without a
 * separate bot account/GitHub App.
 */
@Injectable()
export class AiReviewService {
  private readonly logger = new Logger(AiReviewService.name);

  constructor(
    private readonly env: EnvService,
    private readonly http: HttpService,
    private readonly githubAuth: GithubAuthService,
    private readonly githubApi: GithubApiClient,
    private readonly githubService: GithubService,
    private readonly reviewRules: ReviewRulesService,
  ) {}

  async reviewGithubPullRequest(userId: string, pr: PullRequestRef): Promise<AiReviewResult> {
    const accessToken = await this.githubAuth.getDecryptedToken(userId);
    if (!accessToken) {
      throw new BadRequestException('No connected GitHub account found for this user.');
    }

    const diff = await this.githubApi.getPullRequestDiff(accessToken, pr.repositoryFullName, pr.number);
    if (!diff.trim()) {
      throw new BadRequestException('This pull request has no diff to review.');
    }

    // Best-effort enrichment so the review reflects the actual project, PR,
    // and any team-authored rules — a failure here must never block the
    // review itself.
    const [projectContext, files, rules] = await Promise.all([
      this.gatherProjectContext(accessToken, pr.repositoryFullName),
      this.githubApi.listPullRequestFiles(accessToken, pr.repositoryFullName, pr.number).catch((err) => {
        this.logger.warn(
          `Failed to list changed files for ${pr.repositoryFullName}#${pr.number}: ${(err as Error).message}`,
        );
        return [] as GithubPullFile[];
      }),
      this.reviewRules.listRules(userId, pr.repositoryFullName).catch((err) => {
        this.logger.warn(`Failed to load review rules for ${pr.repositoryFullName}: ${(err as Error).message}`);
        return [] as ReviewRule[];
      }),
    ]);
    const prContext = this.formatPrContext(pr, files);
    const rulesContext = this.reviewRules.formatForPrompt(
      this.reviewRules.matchRules(rules, files.map((f) => f.filename)),
    );

    const body = await this.generateReview(pr.title, diff, projectContext, prContext, rulesContext);

    const posted = await this.githubApi.submitReview(accessToken, pr.repositoryFullName, pr.number, {
      body,
      event: 'COMMENT',
    });
    
    try {
      await this.githubService.syncForUser(userId);
    } catch (err) {
      this.logger.warn(`Post-review sync failed for user ${userId}: ${(err as Error).message}`);
    }

    return { body, githubReviewUrl: posted.html_url };
  }

  /**
   * Repo language/topics/description, a package.json-derived dependency
   * list, and a folder-structure/architecture sketch — all best-effort.
   */
  private async gatherProjectContext(accessToken: string, fullName: string): Promise<string> {
    try {
      const repo = await this.githubApi.getRepoDetails(accessToken, fullName);
      const [dependencies, tree] = await Promise.all([
        this.detectDependencies(accessToken, fullName, repo.default_branch),
        this.githubApi.getRepoTree(accessToken, fullName, repo.default_branch).catch((err) => {
          this.logger.warn(`Failed to fetch repo tree for ${fullName}: ${(err as Error).message}`);
          return [] as string[];
        }),
      ]);

      const sections = [
        repo.language ? `Primary language: ${repo.language}` : null,
        repo.topics.length ? `Topics: ${repo.topics.slice(0, 8).join(', ')}` : null,
        repo.description ? `Description: ${repo.description}` : null,
        dependencies,
        this.describeArchitecture(tree),
      ].filter((s): s is string => Boolean(s));

      return sections.join('\n');
    } catch (err) {
      this.logger.warn(`Failed to fetch project context for ${fullName}: ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * Turns a flat file-path listing into a compact architecture sketch: which
   * top-level folders hold most of the code, which layered-file conventions
   * (controller/service/module/...) recur, and which framework/tooling
   * markers are present. This is what lets the reviewer judge a change
   * against the codebase's *own* structure instead of generic best practice.
   */
  private describeArchitecture(paths: string[]): string {
    const NOISE = /(^|\/)(node_modules|dist|build|out|coverage|\.git|\.next|vendor|target)(\/|$)/;
    const relevant = paths.filter((p) => !NOISE.test(p));
    if (!relevant.length) return '';

    const topLevel = new Map<string, number>();
    for (const p of relevant) {
      const [first] = p.split('/');
      topLevel.set(first, (topLevel.get(first) ?? 0) + 1);
    }
    const layout = [...topLevel.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([dir, count]) => `${dir}/ (${count})`)
      .join(', ');

    const layerCounts = new Map<string, number>();
    for (const p of relevant) {
      const layer = this.classifyFileLayer(p);
      if (layer) layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
    }
    const layers = [...layerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label}s (${count})`)
      .join(', ');

    const MARKERS: [string, string][] = [
      ['nest-cli.json', 'NestJS'],
      ['next.config.js', 'Next.js'],
      ['next.config.ts', 'Next.js'],
      ['angular.json', 'Angular'],
      ['vue.config.js', 'Vue'],
      ['prisma/schema.prisma', 'Prisma ORM'],
      ['Dockerfile', 'Docker'],
      ['docker-compose.yml', 'Docker Compose'],
      ['.github/workflows', 'GitHub Actions CI'],
    ];
    const markers = [...new Set(MARKERS.filter(([marker]) => relevant.some((p) => p.startsWith(marker))).map(([, label]) => label))];

    return [
      layout && `Top-level layout: ${layout}`,
      layers && `Recurring layer conventions: ${layers}`,
      markers.length && `Tooling detected: ${markers.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Classifies a file path into an architectural layer by its naming convention, or null if unrecognized. */
  private classifyFileLayer(path: string): string | null {
    const PATTERNS: [RegExp, string][] = [
      [/\.controller\.ts$/, 'controller'],
      [/\.service\.ts$/, 'service'],
      [/\.module\.ts$/, 'module'],
      [/\.dto\.ts$/, 'dto'],
      [/\.(entity|model)\.ts$/, 'entity'],
      [/\.repository\.ts$/, 'repository'],
      [/\.guard\.ts$/, 'guard'],
      [/\.middleware\.ts$/, 'middleware'],
      [/\.(spec|test)\.tsx?$/, 'test'],
      [/\.(tsx|jsx)$/, 'component'],
    ];
    return PATTERNS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
  }

  /** Best-effort tech-stack sniff via package.json — absence (non-Node project, 404, bad JSON) is a normal outcome. */
  private async detectDependencies(accessToken: string, fullName: string, ref: string): Promise<string | null> {
    try {
      const raw = await this.githubApi.getFileContent(accessToken, fullName, 'package.json', ref);
      if (!raw) return null;

      const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (!deps.length) return null;

      const shown = deps.slice(0, MAX_DEPENDENCIES_LISTED);
      const more = deps.length > shown.length ? `, and ${deps.length - shown.length} more` : '';
      return `Key dependencies: ${shown.join(', ')}${more}`;
    } catch {
      return null; // malformed package.json shouldn't fail the whole review
    }
  }

  /** PR description plus the full changed-file list, so scope is known even where the diff gets truncated. */
  private formatPrContext(pr: PullRequestRef, files: GithubPullFile[]): string {
    const parts: string[] = [];

    if (pr.description?.trim()) {
      parts.push(`Description: ${pr.description.trim().slice(0, MAX_DESCRIPTION_CHARS)}`);
    }

    if (files.length) {
      const shown = files.slice(0, MAX_FILES_LISTED).map((f) => {
        const layer = this.classifyFileLayer(f.filename);
        return `${f.filename} (${f.status}${layer ? `, ${layer}` : ''})`;
      });
      const more = files.length > shown.length ? `, and ${files.length - shown.length} more` : '';
      parts.push(`Files changed (${files.length}): ${shown.join(', ')}${more}`);
    }

    return parts.join('\n');
  }

  /**
   * Loads the reviewer system prompt from disk on every call — deliberately
   * not cached, so editing prompts/review-system-prompt.md takes effect on
   * the next review with no code change, rebuild, or restart required.
   */
  private async loadSystemPrompt(): Promise<string> {
    try {
      return (await readFile(SYSTEM_PROMPT_PATH, 'utf-8')).trim();
    } catch (err) {
      this.logger.error(`Failed to read system prompt at ${SYSTEM_PROMPT_PATH}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('AI review is misconfigured: the reviewer prompt could not be loaded.');
    }
  }

  private async generateReview(
    prTitle: string,
    diff: string,
    projectContext: string,
    prContext: string,
    rulesContext: string,
  ): Promise<string> {
    const apiKey = this.env.AI.GROQ_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI review is not configured. Set GROQ_API_KEY in the environment to enable it.',
      );
    }

    const truncated = diff.length > MAX_DIFF_CHARS;
    const clippedDiff = truncated ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (diff truncated)` : diff;

    const contextBlock = [
      projectContext && `## Project context\n${projectContext}`,
      rulesContext && `## Team review rules\n${rulesContext}`,
      `## Pull request context\nTitle: ${prTitle}${prContext ? `\n${prContext}` : ''}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const systemPrompt = await this.loadSystemPrompt();

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          GROQ_API_URL,
          {
            model: this.env.AI.GROQ_MODEL ?? DEFAULT_MODEL,
            max_tokens: MAX_COMPLETION_TOKENS,
            // GPT-OSS is a reasoning model — it spends tokens "thinking" in a
            // separate field before writing the final answer. Without this,
            // a tight max_tokens budget can be fully consumed by reasoning,
            // leaving message.content empty. A code review doesn't need deep
            // multi-step reasoning, so keep it minimal and leave the budget
            // for the actual review text.
            reasoning_effort: 'low',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `${contextBlock}\n\n## Diff\n\`\`\`diff\n${clippedDiff}\n\`\`\`` },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
            },
            timeout: 60_000,
          },
        ),
      );

      // Fall back to the reasoning trace if content ever comes back empty
      // (e.g. the model used its whole token budget on reasoning) rather
      // than failing the whole request outright.
      const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning;
      if (!text) {
        throw new Error('Empty response from Groq');
      }
      return text;
    } catch (err) {
      const error = err as AxiosError<{ error?: { code?: string; type?: string } }>;
      this.logger.error(
        `Groq review generation failed (status=${error?.response?.status}): ` +
          `${JSON.stringify(error?.response?.data)?.slice(0, 500)}`,
      );

      const groqError = error?.response?.data?.error;
      if (error?.response?.status === 413 || groqError?.code === 'rate_limit_exceeded') {
        throw new BadRequestException(
          'This pull request is too large for AI review right now (the free-tier AI provider has a ' +
            'per-minute token limit). Try again in a minute, or use it on a smaller pull request.',
        );
      }

      throw new ServiceUnavailableException('AI review generation failed. Please try again later.');
    }
  }
}
