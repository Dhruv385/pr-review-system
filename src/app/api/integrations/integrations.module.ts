import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { IntegrationsController } from './integrations.controller';
import { AiReviewModule } from '@api/ai-review/ai-review.module';

@Module({
  imports: [
    // Named + scoped to this module, isolated from the 'auth' throttler
    // group — a CI workflow polling this endpoint shouldn't be able to
    // exhaust (or be limited by) the login/register rate limit, or vice versa.
    ThrottlerModule.forRoot([{ name: 'integrations', ttl: 60_000, limit: 5 }]),
    AiReviewModule,
  ],
  controllers: [IntegrationsController],
})
export class IntegrationsModule {}
