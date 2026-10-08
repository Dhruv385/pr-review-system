import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EnvService } from '@shared/env';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { minimatch } from 'minimatch';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { GithubAuthService } from '@api/github/github-auth.service';
import { GithubApiClient, GithubPullFile, GithubReview } from '@api/github/github-api.client';
import { GithubService } from '@api/github/github.service';
import { ReviewRulesService, ProjectConfig } from '@api/review-rules/review-rules.service';

// Read fresh from disk on every call (not cached in memory) so editing the
// wording is a content change, not a code change — no redeploy or restart
// needed to pick it up. `assets` in nest-cli.json copies this directory next
// to the compiled service in dist/ on build.
const PROMPTS_DIR = join(__dirname, 'prompts');
const REVIEW_SYSTEM_PROMPT_FILE = 'review-system-prompt.md';
const REPO_ANALYSIS_PROMPT_FILE = 'repo-analysis-prompt.md';
const MAX_ANALYSIS_COMPLETION_TOKENS = 3_000;
const MAX_README_CHARS = 2_000;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b'; // free-tier on Groq — llama-3.3-70b-versatile is enterprise-only now
const MAX_COMPLETION_TOKENS = 4500;
// Groq's free tier caps at 8000 tokens/minute *total* (prompt + completion).
// Kept well under that with margin: ~4 chars/token for diff text, plus the
// system prompt, plus the project/PR/rules/previous-findings/full-file
// context, plus MAX_COMPLETION_TOKENS reserved for the response. Trimmed
// down from the diff-only budget to make room for the context sections below.
const MAX_DIFF_CHARS = 8_000;
const MAX_DEPENDENCIES_LISTED = 15;
const MAX_FILES_LISTED = 30;
const MAX_DESCRIPTION_CHARS = 800;
const MAX_PREVIOUS_FINDINGS_CHARS = 3_000;
// A diff hunk alone can't prove a changed/removed symbol (e.g. an import) is
// unused elsewhere in the file — only the full file can. Fetched for a small,
// budget-capped subset of changed files (smallest diffs first, since those
// are cheapest and least likely to already be fully visible in the diff).
const MAX_FULL_FILE_FETCH_COUNT = 4;
const MAX_FULL_FILE_CHARS = 1_200;
const MAX_FULL_FILE_CONTEXT_CHARS = 3_000;

// Appended to every AI-generated review body (invisible in rendered
// markdown) so a later review of the same PR can reliably find its own
// prior output among GitHub's review list — human reviews from the same
// connected account never carry this marker.
export const AI_REVIEW_MARKER = '<!-- pr-review-system:ai-review -->';

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

/** Structured config an LLM suggests after analyzing a repo — same shape as ReviewRulesService's UpdateProjectConfigInput. */
interface SuggestedProjectConfig {
  architectureNotes: string | null;
  conventions: string | null;
  focusAreas: string[];
  excludePatterns: string[];
}

export interface RepositoryAssessmentResult {
  report: string;
  suggestedConfig: SuggestedProjectConfig | null;
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
    private readonly prisma: PrismaService,
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
    // any team-authored rules/project config, and any unresolved findings
    // from the last AI review of this same PR — a failure here must never
    // block the review itself.
    const [projectContext, rawFiles, config, previousReviews, headSha] = await Promise.all([
      this.gatherProjectContext(accessToken, pr.repositoryFullName),
      this.githubApi.listPullRequestFiles(accessToken, pr.repositoryFullName, pr.number).catch((err) => {
        this.logger.warn(
          `Failed to list changed files for ${pr.repositoryFullName}#${pr.number}: ${(err as Error).message}`,
        );
        return [] as GithubPullFile[];
      }),
      this.reviewRules.getConfig(userId, pr.repositoryFullName).catch((err) => {
        this.logger.warn(`Failed to load review config for ${pr.repositoryFullName}: ${(err as Error).message}`);
        return { architectureNotes: null, conventions: null, focusAreas: [], excludePatterns: [], rules: [] } as ProjectConfig;
      }),
      this.githubApi.listReviews(accessToken, pr.repositoryFullName, pr.number).catch((err) => {
        this.logger.warn(
          `Failed to list previous reviews for ${pr.repositoryFullName}#${pr.number}: ${(err as Error).message}`,
        );
        return [] as GithubReview[];
      }),
      this.githubApi.getPullRequestHeadSha(accessToken, pr.repositoryFullName, pr.number).catch((err) => {
        this.logger.warn(
          `Failed to fetch head ref for ${pr.repositoryFullName}#${pr.number}: ${(err as Error).message}`,
        );
        return null;
      }),
    ]);

    // excludePatterns is enforced here in code — filtering both the file
    // list and the diff text itself — rather than left as a prompt hint the
    // model might not reliably follow.
    const { diff: scopedDiff, files } = this.excludeMatchedFiles(diff, rawFiles, config.excludePatterns);
    if (!scopedDiff.trim()) {
      throw new BadRequestException('Every changed file in this pull request is excluded from review by the project config.');
    }

    const prContext = this.formatPrContext(pr, files);
    const projectConfigContext = this.reviewRules.formatConfigForPrompt(config);
    const rulesContext = this.reviewRules.formatForPrompt(
      this.reviewRules.matchRules(config.rules, files.map((f) => f.filename)),
    );
    const previousFindingsContext = this.formatPreviousFindings(previousReviews);
    const fullFileContext = headSha
      ? await this.gatherFullFileContents(accessToken, pr.repositoryFullName, headSha, files)
      : '';

    const body = await this.generateReview(
      pr.title,
      scopedDiff,
      projectContext,
      projectConfigContext,
      prContext,
      rulesContext,
      previousFindingsContext,
      fullFileContext,
    );

    const posted = await this.githubApi.submitReview(accessToken, pr.repositoryFullName, pr.number, {
      body: `${body}\n\n${AI_REVIEW_MARKER}`,
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
   * Enforces `excludePatterns` in code rather than as a prompt hint the
   * model might not reliably follow — filters excluded files out of both
   * the changed-file list and the diff text itself (split on git's
   * `diff --git a/... b/...` file boundaries) before anything downstream
   * (rules matching, full-file-context, the prompt) ever sees them.
   */
  private excludeMatchedFiles(
    diff: string,
    files: GithubPullFile[],
    excludePatterns: string[],
  ): { diff: string; files: GithubPullFile[] } {
    if (!excludePatterns.length) return { diff, files };

    const isExcluded = (path: string) => excludePatterns.some((p) => minimatch(path, p, { dot: true }));
    const filteredFiles = files.filter((f) => !isExcluded(f.filename));

    const blocks = diff.split(/(?=^diff --git a\/.* b\/.*$)/m);
    const filteredDiff = blocks
      .filter((block) => {
        const header = /^diff --git a\/.* b\/(.*)$/m.exec(block);
        return !header || !isExcluded(header[1].trim());
      })
      .join('');

    return { diff: filteredDiff, files: filteredFiles };
  }

  /**
   * Analyzes a repo's architecture/conventions and produces an assessment
   * report plus a suggested project config — for onboarding a project taken
   * over mid-way from another team/vendor, where the default review prompt
   * would otherwise produce irrelevant findings. Persists the latest result
   * per (user, repo); applying it to the actual review config is a separate,
   * explicit step (applyRepositoryAssessmentConfig) — nothing here writes to
   * ReviewRule directly.
   */
  async analyzeGithubRepository(userId: string, repositoryFullName: string): Promise<RepositoryAssessmentResult> {
    const accessToken = await this.githubAuth.getDecryptedToken(userId);
    if (!accessToken) {
      throw new BadRequestException('No connected GitHub account found for this user.');
    }

    const [projectContext, readme] = await Promise.all([
      this.gatherProjectContext(accessToken, repositoryFullName),
      this.githubApi.getFileContent(accessToken, repositoryFullName, 'README.md').catch((err) => {
        this.logger.warn(`Failed to fetch README for ${repositoryFullName}: ${(err as Error).message}`);
        return null;
      }),
    ]);

    const userContent =
      [
        projectContext && `## Project context\n${projectContext}`,
        readme &&
          `## README excerpt\n${readme.length > MAX_README_CHARS ? `${readme.slice(0, MAX_README_CHARS)}\n... (truncated)` : readme}`,
      ]
        .filter(Boolean)
        .join('\n\n') || 'No project context or README available for this repository.';

    const systemPrompt = await this.readPromptFile(REPO_ANALYSIS_PROMPT_FILE);
    const text = await this.callGroq(systemPrompt, userContent, MAX_ANALYSIS_COMPLETION_TOKENS);
    const result = this.parseAnalysisOutput(text);

    await this.prisma.repositoryAssessment.upsert({
      where: { userId_repositoryFullName: { userId, repositoryFullName } },
      create: {
        userId,
        repositoryFullName,
        report: result.report,
        suggestedConfig: (result.suggestedConfig as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
      update: {
        report: result.report,
        suggestedConfig: (result.suggestedConfig as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });

    return result;
  }

  /**
   * Applies the latest persisted repo analysis's suggested config to the
   * repo's actual ReviewRule config — a separate, explicit step from
   * analyzeGithubRepository so nothing gets written without a deliberate
   * confirm call.
   */
  async applyRepositoryAssessmentConfig(userId: string, repositoryFullName: string): Promise<ProjectConfig> {
    const assessment = await this.prisma.repositoryAssessment.findUnique({
      where: { userId_repositoryFullName: { userId, repositoryFullName } },
    });
    if (!assessment) {
      throw new BadRequestException('No repository analysis found for this repo yet — run analysis first.');
    }

    const suggested = assessment.suggestedConfig as unknown as SuggestedProjectConfig | null;
    if (!suggested) {
      throw new BadRequestException('The latest analysis for this repo has no suggested config to apply.');
    }

    return this.reviewRules.updateConfig(userId, repositoryFullName, {
      architectureNotes: suggested.architectureNotes,
      conventions: suggested.conventions,
      focusAreas: suggested.focusAreas,
      excludePatterns: suggested.excludePatterns,
    });
  }

  /**
   * Splits the model's output into the human-readable report and the
   * trailing ```json suggested-config block. Parse failure (missing block,
   * malformed JSON, wrong shape) degrades to a null suggestedConfig — the
   * report text is still returned either way, this must never hard-fail
   * the whole analysis.
   */
  private parseAnalysisOutput(text: string): RepositoryAssessmentResult {
    const match = /```json\s*([\s\S]*?)```/.exec(text);
    if (!match) return { report: text.trim(), suggestedConfig: null };

    const report = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
    try {
      const parsed = JSON.parse(match[1]);
      const suggestedConfig: SuggestedProjectConfig = {
        architectureNotes: typeof parsed.architectureNotes === 'string' ? parsed.architectureNotes : null,
        conventions: typeof parsed.conventions === 'string' ? parsed.conventions : null,
        focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas.filter((f: unknown) => typeof f === 'string') : [],
        excludePatterns: Array.isArray(parsed.excludePatterns)
          ? parsed.excludePatterns.filter((p: unknown) => typeof p === 'string')
          : [],
      };
      return { report, suggestedConfig };
    } catch (err) {
      this.logger.warn(`Failed to parse suggested config JSON from repo analysis: ${(err as Error).message}`);
      return { report: text.trim(), suggestedConfig: null };
    }
  }

  /**
   * Finds this app's own most recent AI review of the PR (identified by
   * AI_REVIEW_MARKER, so a human review from the same connected account is
   * never mistaken for one) and returns its body, marker stripped, capped
   * defensively. Returns '' if there is none yet.
   */
  private formatPreviousFindings(reviews: GithubReview[]): string {
    const aiReviews = reviews
      .filter((r) => r.body?.includes(AI_REVIEW_MARKER))
      .sort((a, b) => new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime());

    const latest = aiReviews[0]?.body;
    if (!latest) return '';

    const cleaned = latest.replace(AI_REVIEW_MARKER, '').trim();
    return cleaned.length > MAX_PREVIOUS_FINDINGS_CHARS
      ? `${cleaned.slice(0, MAX_PREVIOUS_FINDINGS_CHARS)}\n\n... (truncated)`
      : cleaned;
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
   * Fetches full current content (at the PR's head commit) for a small,
   * budget-capped subset of changed files, so the reviewer can check whether
   * a changed or removed symbol (e.g. an import) is genuinely unused
   * elsewhere in the file instead of guessing from the diff hunk alone.
   * Smallest diffs first — cheapest to include and least likely to already
   * be fully visible in the diff itself. Best-effort throughout: a failed
   * fetch for one file just drops that file, never fails the whole review.
   */
  private async gatherFullFileContents(
    accessToken: string,
    fullName: string,
    headSha: string,
    files: GithubPullFile[],
  ): Promise<string> {
    const candidates = [...files]
      .filter((f) => f.status !== 'removed')
      .sort((a, b) => a.additions + a.deletions - (b.additions + b.deletions))
      .slice(0, MAX_FULL_FILE_FETCH_COUNT);

    const sections: string[] = [];
    let budgetLeft = MAX_FULL_FILE_CONTEXT_CHARS;

    for (const file of candidates) {
      if (budgetLeft <= 0) break;

      const content = await this.githubApi
        .getFileContent(accessToken, fullName, file.filename, headSha)
        .catch((err) => {
          this.logger.warn(`Failed to fetch full content for ${file.filename}: ${(err as Error).message}`);
          return null;
        });
      if (!content) continue;

      const perFileCap = Math.min(MAX_FULL_FILE_CHARS, budgetLeft);
      const clipped = content.length > perFileCap ? `${content.slice(0, perFileCap)}\n... (truncated)` : content;
      sections.push(`### ${file.filename}\n\`\`\`\n${clipped}\n\`\`\``);
      budgetLeft -= clipped.length;
    }

    return sections.join('\n\n');
  }

  /**
   * Loads a prompt file from disk on every call — deliberately not cached,
   * so editing wording in prompts/ takes effect on the next call with no
   * code change, rebuild, or restart required.
   */
  private async readPromptFile(filename: string): Promise<string> {
    const filePath = join(PROMPTS_DIR, filename);
    try {
      return (await readFile(filePath, 'utf-8')).trim();
    } catch (err) {
      this.logger.error(`Failed to read prompt file at ${filePath}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('AI review is misconfigured: a required prompt file could not be loaded.');
    }
  }

  /**
   * Small local models occasionally get stuck reasoning in a loop, repeating
   * the same line dozens of times instead of producing a real answer — a
   * failure mode with no useful signal in it, and it must never be posted to
   * GitHub as if it were a real review. Flags output where a single line
   * (ignoring code-fence markers and short/blank lines) repeats often enough
   * that it can't plausibly be legitimate review content.
   */
  private isDegenerateOutput(text: string): boolean {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && !l.startsWith('```'));
    if (lines.length < 20) return false;

    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    const mostRepeated = Math.max(...counts.values());

    return mostRepeated >= 8 || mostRepeated / lines.length > 0.3;
  }

  private async generateReview(
    prTitle: string,
    diff: string,
    projectContext: string,
    projectConfigContext: string,
    prContext: string,
    rulesContext: string,
    previousFindingsContext: string,
    fullFileContext: string,
  ): Promise<string> {
    const truncated = diff.length > MAX_DIFF_CHARS;
    const clippedDiff = truncated ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (diff truncated)` : diff;

    const contextBlock = [
      projectContext && `## Project context\n${projectContext}`,
      projectConfigContext && `## Project review configuration\n${projectConfigContext}`,
      rulesContext && `## Team review rules\n${rulesContext}`,
      `## Pull request context\nTitle: ${prTitle}${prContext ? `\n${prContext}` : ''}`,
      previousFindingsContext && `## Previous AI review findings\n${previousFindingsContext}`,
      fullFileContext &&
        `## Full file contents (current, at the PR head — use to verify usage before flagging missing/unused symbols)\n${fullFileContext}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const systemPrompt = await this.readPromptFile(REVIEW_SYSTEM_PROMPT_FILE);
    return this.callGroq(
      systemPrompt,
      `${contextBlock}\n\n## Diff\n\`\`\`diff\n${clippedDiff}\n\`\`\``,
      MAX_COMPLETION_TOKENS,
    );
  }

  /**
   * Raw Groq chat-completion call shared by review generation and repo
   * analysis: request shape, response extraction (with the reasoning-trace
   * fallback for reasoning models that can exhaust their budget "thinking"),
   * degenerate-output rejection, and error mapping all live here once
   * instead of being duplicated per caller.
   */
  private async callGroq(systemPrompt: string, userContent: string, maxTokens: number): Promise<string> {
    const apiKey = this.env.AI.GROQ_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI review is not configured. Set GROQ_API_KEY in the environment to enable it.',
      );
    }

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          GROQ_API_URL,
          {
            model: this.env.AI.GROQ_MODEL ?? DEFAULT_MODEL,
            max_tokens: maxTokens,
            // Low, not zero: keeps output deterministic run to run while
            // avoiding the degenerate repetition some models fall into at
            // temperature 0.
            temperature: 0.2,
            // gpt-oss-20b occasionally gets stuck restating the same
            // reasoning line dozens of times instead of producing a real
            // answer, especially on a longer, multi-section prompt.
            // Penalizing repeated tokens makes that loop less likely to
            // start in the first place; isDegenerateOutput() below is the
            // backstop for when it happens anyway.
            frequency_penalty: 0.4,
            presence_penalty: 0.2,
            // GPT-OSS is a reasoning model — it spends tokens "thinking" in a
            // separate field before writing the final answer. Without this,
            // a tight max_tokens budget can be fully consumed by reasoning,
            // leaving message.content empty. Keep it minimal and leave the
            // budget for the actual output text.
            reasoning_effort: 'low',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
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
      if (this.isDegenerateOutput(text)) {
        this.logger.error(
          `Groq returned a degenerate/repetitive response (${text.length} chars) — rejecting it rather than using it.`,
        );
        throw new Error('Degenerate response from Groq');
      }
      return text;
    } catch (err) {
      const error = err as AxiosError<{ error?: { code?: string; type?: string } }>;
      this.logger.error(
        `Groq call failed (status=${error?.response?.status}): ${JSON.stringify(error?.response?.data)?.slice(0, 500)}`,
      );

      const groqError = error?.response?.data?.error;
      if (error?.response?.status === 413 || groqError?.code === 'rate_limit_exceeded') {
        throw new BadRequestException(
          'This request is too large for AI processing right now (the free-tier AI provider has a ' +
            'per-minute token limit). Try again in a minute, or use a smaller input.',
        );
      }

      throw new ServiceUnavailableException('AI processing failed. Please try again later.');
    }
  }
}
