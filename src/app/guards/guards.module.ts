import { Global, Module } from '@nestjs/common';
import { TokenModule } from '@shared/token/token.module';
import { JwtAuthGuard } from './jwt';
import { BasicAuthGuard, BasicStrategy } from './basic';
import { CiTriggerGuard } from './ci-trigger';

/**
 * Registers the app-wide guards as providers once, so any controller can
 * `@UseGuards(JwtAuthGuard)` / `@UseGuards(BasicAuthGuard)` without its
 * module needing to import them directly (mirrors the previous @Global()
 * AuthModule, which provided these guards implicitly).
 */
@Global()
@Module({
  imports: [TokenModule],
  providers: [JwtAuthGuard, BasicAuthGuard, BasicStrategy, CiTriggerGuard],
  exports: [JwtAuthGuard, BasicAuthGuard, BasicStrategy, CiTriggerGuard],
})
export class GuardsModule {}
