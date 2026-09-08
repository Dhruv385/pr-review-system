import { Module } from '@nestjs/common';
import { EnvModule } from '@shared/env';
import { LoggerModule } from '@shared/logger';
import { GuardsModule } from './guards/guards.module';
import { ApiModule } from './api/api.module';

@Module({
    imports: [
        EnvModule,
        LoggerModule.register({ context: AppModule.name }),
        GuardsModule,
        ApiModule,
    ],
})
export class AppModule { }
