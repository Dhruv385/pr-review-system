import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { CONTEXT_CONFIG } from './logger.constant';

export interface RegisterOptions {
  context: string;
}

@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {
  static register(options: RegisterOptions): DynamicModule {
    return {
      module: LoggerModule,
      providers: [{ provide: CONTEXT_CONFIG, useValue: options.context }],
    };
  }
}
