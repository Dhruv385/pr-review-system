import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EnvService } from '@shared/env';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { GithubAuthService } from '@api/github/github-auth.service';
import { GithubApiClient } from '@api/github/github-api.client';
import { GithubService } from '@api/github/github.service';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b'; // free-tier on Groq — llama-3.3-70b-versatile is enterprise-only now
const MAX_COMPLETION_TOKENS = 1000;
// Groq's free tier caps at 8000 tokens/minute *total* (prompt + completion).
// Kept well under that with margin: ~4 chars/token for diff text, plus the
// system prompt, plus MAX_COMPLETION_TOKENS reserved for the response.
const MAX_DIFF_CHARS = 12_000;

interface PullRequestRef {
  repositoryFullName: string;
  number: number;
  title: string;
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

    const body = await this.generateReview(pr.title, diff);

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

  private async generateReview(prTitle: string, diff: string): Promise<string> {
    const apiKey = this.env.AI.GROQ_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI review is not configured. Set GROQ_API_KEY in the environment to enable it.',
      );
    }

    const truncated = diff.length > MAX_DIFF_CHARS;
    const clippedDiff = truncated ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (diff truncated)` : diff;

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
              {
                role: 'system',
                content:
                  'You are an expert code reviewer leaving a review on a GitHub pull request. Read the ' +
                  'unified diff and identify real bugs, security issues, and correctness problems — not ' +
                  'style nitpicks unless they are significant. Be concise and specific, referencing file ' +
                  'names from the diff. Write in GitHub-flavored markdown suitable for posting directly as ' +
                  'a PR review comment. End with a one-line verdict.',
              },
              { role: 'user', content: `PR title: ${prTitle}\n\nDiff:\n\`\`\`diff\n${clippedDiff}\n\`\`\`` },
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
