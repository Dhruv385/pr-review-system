import { Module } from '@nestjs/common';
import { ReviewRulesService } from './review-rules.service';
import { DatabaseModule } from '@shared/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [ReviewRulesService],
  exports: [ReviewRulesService],
})
export class ReviewRulesModule {}
