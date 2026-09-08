import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SyncModule } from '@/common/sync.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule, SyncModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule { }
