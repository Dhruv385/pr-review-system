import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AppLogger } from '@shared/logger';

/**
 * Emits one structured log line per request: requestId, userId (once
 * JwtAuthGuard has run), method, path, statusCode, durationMs. Wired in
 * globally in main.ts so every route gets this for free.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new AppLogger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = context.switchToHttp().getResponse<Response>();

    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const start = Date.now();

    const logLine = (statusCode: number) => {
      const durationMs = Date.now() - start;
      this.logger.log(
        JSON.stringify({
          requestId,
          userId: req.user?.id ?? null,
          method: req.method,
          path: req.originalUrl,
          statusCode,
          durationMs,
        }),
      );
    };

    return next.handle().pipe(
      tap(() => logLine(res.statusCode)),
      catchError((err) => {
        logLine(err?.status ?? 500);
        return throwError(() => err);
      }),
    );
  }
}
