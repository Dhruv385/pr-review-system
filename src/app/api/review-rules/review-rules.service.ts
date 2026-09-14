import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { minimatch } from 'minimatch';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';

export interface ReviewRule {
  id: string;
  text: string;
  /** Glob matched against changed file paths. Null = applies to every file in the repo. */
  pattern: string | null;
  source: string;
  createdAt: string;
}

export interface CreateReviewRuleInput {
  text: string;
  pattern?: string | null;
  source?: string;
}

const MAX_RULES_IN_PROMPT = 20;
const MAX_RULE_TEXT_CHARS = 300;

/**
 * Custom AI review rules, scoped by (userId, repositoryFullName) — a rule
 * applies to every PR in that repo, not just the one it was created from.
 * All rules for a given (user, repo) live in a single row as a JSON array
 * (mirroring the original .pr-review/rules.json shape) rather than one row
 * per rule.
 */
@Injectable()
export class ReviewRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(userId: string, repositoryFullName: string): Promise<ReviewRule[]> {
    const row = await this.prisma.reviewRule.findUnique({
      where: { userId_repositoryFullName: { userId, repositoryFullName } },
    });
    return this.parseRules(JSON.stringify(row?.rules ?? []));
  }

  /** A rule with no pattern applies everywhere; otherwise it must glob-match at least one changed file. */
  matchRules(rules: ReviewRule[], filenames: string[]): ReviewRule[] {
    return rules.filter(
      (rule) => !rule.pattern || filenames.some((f) => minimatch(f, rule.pattern as string, { dot: true })),
    );
  }

  /** Renders matched rules as a prompt section, capped so a large rule set can't blow the token budget. */
  formatForPrompt(rules: ReviewRule[]): string {
    if (!rules.length) return '';

    const shown = rules.slice(0, MAX_RULES_IN_PROMPT).map((rule) => {
      const scope = rule.pattern ? `[${rule.pattern}]` : '[all files]';
      return `- ${scope} ${rule.text.slice(0, MAX_RULE_TEXT_CHARS)}`;
    });
    const more = rules.length > shown.length ? `\n- ...and ${rules.length - shown.length} more rules not shown` : '';

    return shown.join('\n') + more;
  }

  /** Appends to the single (userId, repositoryFullName) row, creating it on first use. */
  async addRule(userId: string, repositoryFullName: string, input: CreateReviewRuleInput): Promise<ReviewRule> {
    const existing = await this.prisma.reviewRule.findUnique({
      where: { userId_repositoryFullName: { userId, repositoryFullName } },
    });
    const rules = this.parseRules(JSON.stringify(existing?.rules ?? []));

    const rule: ReviewRule = {
      id: randomUUID().slice(0, 8),
      text: input.text.trim(),
      pattern: input.pattern?.trim() || null,
      source: input.source ?? 'manual',
      createdAt: new Date().toISOString(),
    };
    rules.push(rule);

    await this.prisma.reviewRule.upsert({
      where: { userId_repositoryFullName: { userId, repositoryFullName } },
      create: { userId, repositoryFullName, rules: rules as unknown as Prisma.InputJsonValue },
      update: { rules: rules as unknown as Prisma.InputJsonValue },
    });

    return rule;
  }

  /** Defensive against a hand-edited or legacy-shaped JSON blob — malformed entries are dropped, not thrown on. */
  private parseRules(raw: unknown): ReviewRule[] {
    if (!Array.isArray(raw)) return [];

    return raw
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
        source: typeof entry.source === 'string' ? entry.source : 'manual',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      }));
  }
}
