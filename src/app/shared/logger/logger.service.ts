import { ConsoleLogger, Inject, Injectable, Optional } from '@nestjs/common';
import { CONTEXT_CONFIG } from './logger.constant';

/**
 * Thin wrapper over Nest's built-in ConsoleLogger. Gives every call site the
 * same shape as a "real" structured logger (context-bound, module-registered
 * via LoggerModule.register()) without adding a logging dependency.
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  constructor(@Optional() @Inject(CONTEXT_CONFIG) context?: string) {
    super(context ?? AppLogger.name);
  }
}
