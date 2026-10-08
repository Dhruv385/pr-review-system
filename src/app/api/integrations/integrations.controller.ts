import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { EnvService } from '@shared/env';
import { CiTriggerGuard } from '@guards/ci-trigger';
import { AiReviewService } from '@api/ai-review/ai-review.service';
import { TriggerReviewDto } from './dto/trigger-review.dto';

/**
 * Machine-to-machine entry point for triggering an AI review from outside
 * this app entirely — e.g. a one-line curl call from another repo's own
 * GitHub Actions workflow. Deliberately thin: it does nothing but map an
 * external caller's request onto the exact same AiReviewService.
 * reviewGithubPullRequest(...) the authenticated dashboard flow already
 * calls, always acting as the single pre-connected account configured via
 * CI_TRIGGER_USER_ID — this is "let me trigger reviews on my own repos from
 * CI," not a multi-tenant integration.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Throttle({ integrations: { limit: 5, ttl: 60_000 } })
@UseGuards(ThrottlerGuard, CiTriggerGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly env: EnvService,
    private readonly aiReviewService: AiReviewService,
  ) {}

  // POST /integrations/trigger-review
  @ApiOperation({
    summary: 'Trigger an AI review for a pull request from an external CI workflow',
    description:
      'Authenticated with a static bearer secret (CI_TRIGGER_SECRET), not a user JWT — meant to be called ' +
      'directly from another repository\'s own GitHub Actions workflow, with no prior sync into this app\'s ' +
      "database required. Always acts as the single account configured via CI_TRIGGER_USER_ID.",
  })
  @ApiResponse({ status: 201, description: 'AI review generated and posted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body, or the PR has no diff to review' })
  @ApiResponse({ status: 401, description: 'Missing or invalid CI trigger secret' })
  @ApiResponse({ status: 403, description: 'Request did not arrive over HTTPS (enforced in production)' })
  @ApiResponse({ status: 429, description: 'Too many requests — rate limited' })
  @ApiResponse({ status: 503, description: 'The AI provider or GitHub API is temporarily unavailable' })
  @Post('trigger-review')
  async triggerReview(@Body() dto: TriggerReviewDto) {
    const result = await this.aiReviewService.reviewGithubPullRequest(this.env.INTEGRATIONS.CI_TRIGGER_USER_ID, {
      repositoryFullName: dto.repositoryFullName,
      number: dto.number,
      title: dto.title,
      description: dto.description ?? null,
    });

    return { reviewed: true, ...result };
  }
}
