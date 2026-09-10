import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { minimatch } from 'minimatch';
import { GithubAuthService } from '@api/github/github-auth.service';
import { GithubApiClient } from '@api/github/github-api.client';

export interface ReviewRule {
  id: string;
  text: string;
  /** Glob matched against changed file paths. Null = applies to every file in the repo. */
  pattern: string | null;
  source: 'manual' | 'pr-comment';
  createdAt: string;
}

export interface CreateReviewRuleInput {
  text: string;
  pattern?: string | null;
  source?: 'manual' | 'pr-comment';
}

// Committed into the target repo itself (not this app's database) so rules
// travel with the repo, are visible/diffable in normal PRs, and don't need
// a "which repos has this user configured" table of our own.
const RULES_FILE_PATH = '.pr-review/rules.json';
const MAX_RULES_IN_PROMPT = 20;
const MAX_RULE_TEXT_CHARS = 300;

/**
 * Reads and writes the per-repo custom review rules file
 * (`.pr-review/rules.json`) that AiReviewService injects into the review
 * prompt. Rules are plain repo content, not app state — creating one is a
 * real commit under the connected GitHub account.
 */
@Injectable()
export class ReviewRulesService {
  private readonly logger = new Logger(ReviewRulesService.name);

  constructor(
    private readonly githubAuth: GithubAuthService,
    private readonly githubApi: GithubApiClient,
  ) {}

  /** Best-effort read — a missing or malformed rules file degrades to [] rather than failing the caller. */
  async listRules(userId: string, repositoryFullName: string): Promise<ReviewRule[]> {
    const accessToken = await this.resolveToken(userId);
    try {
      const raw = await this.githubApi.getFileContent(accessToken, repositoryFullName, RULES_FILE_PATH);
      return raw ? this.parseRules(raw) : [];
    } catch (err) {
      this.logger.warn(`Failed to load review rules for ${repositoryFullName}: ${(err as Error).message}`);
      return [];
    }
  }

  /** A rule with no pattern applies everywhere; otherwise it must glob-match at least one changed file. */
  matchRules(rules: ReviewRule[], filenames: string[]): ReviewRule[] {
    return rules.filter(
      (rule) => !rule.pattern || filenames.some((f) => minimatch(f, rule.pattern as string, { dot: true })),
    );
  }

  /** Renders matched rules as a prompt section, capped so a large rules file can't blow the token budget. */
  formatForPrompt(rules: ReviewRule[]): string {
    if (!rules.length) return '';

    const shown = rules.slice(0, MAX_RULES_IN_PROMPT).map((rule) => {
      const scope = rule.pattern ? `[${rule.pattern}]` : '[all files]';
      return `- ${scope} ${rule.text.slice(0, MAX_RULE_TEXT_CHARS)}`;
    });
    const more = rules.length > shown.length ? `\n- ...and ${rules.length - shown.length} more rules not shown` : '';

    return shown.join('\n') + more;
  }

  /** Appends a rule to the repo's rules file (creating it if needed) and commits the change via the Contents API. */
  async addRule(userId: string, repositoryFullName: string, input: CreateReviewRuleInput): Promise<ReviewRule> {
    const accessToken = await this.resolveToken(userId);
    const existing = await this.githubApi.getFileMeta(accessToken, repositoryFullName, RULES_FILE_PATH);
    const rules = existing ? this.parseRules(existing.content, { strict: true }) : [];

    const rule: ReviewRule = {
      id: randomUUID().slice(0, 8),
      text: input.text.trim(),
      pattern: input.pattern?.trim() || null,
      source: input.source ?? 'manual',
      createdAt: new Date().toISOString(),
    };
    rules.push(rule);

    await this.githubApi.upsertFileContent(
      accessToken,
      repositoryFullName,
      RULES_FILE_PATH,
      `${JSON.stringify({ rules }, null, 2)}\n`,
      `Add review rule: ${rule.text.slice(0, 72)}`,
      { sha: existing?.sha },
    );

    return rule;
  }

  private async resolveToken(userId: string): Promise<string> {
    const accessToken = await this.githubAuth.getDecryptedToken(userId);
    if (!accessToken) {
      throw new BadRequestException('No connected GitHub account found for this user.');
    }
    return accessToken;
  }

  /**
   * `strict` is used on the write path: invalid JSON there means we can't
   * safely determine what's already in the file, so we refuse to guess and
   * silently overwrite it — the caller must fix the file manually first.
   * The read path is more forgiving since it only ever degrades to [].
   */
  private parseRules(raw: string, options: { strict?: boolean } = {}): ReviewRule[] {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      if (options.strict) {
        throw new BadRequestException(
          `${RULES_FILE_PATH} in this repo contains invalid JSON and can't be updated automatically. Fix it manually first.`,
        );
      }
      this.logger.warn(`${RULES_FILE_PATH} contains invalid JSON — ignoring it.`);
      return [];
    }

    const list = (data as { rules?: unknown })?.rules;
    if (!Array.isArray(list)) return [];

    return list
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).text === 'string' &&
          ((entry as Record<string, unknown>).text as string).trim().length > 0,
      )
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : randomUUID().slice(0, 8),
        text: entry.text as string,
        pattern: typeof entry.pattern === 'string' && entry.pattern.trim() ? entry.pattern : null,
        source: entry.source === 'pr-comment' ? 'pr-comment' : 'manual',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      }));
  }
}
