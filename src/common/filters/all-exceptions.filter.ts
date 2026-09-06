import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

/**
 * Catches every unhandled exception in the app so API consumers always get a
 * consistent, safe JSON error shape — and so a raw Prisma/driver error never
 * surfaces as an opaque "Internal server error" with no indication of what
 * actually went wrong (previously only handled ad-hoc in AuthService).
 *
 * Never leaks stack traces or internal details to the client; full detail
 * goes to the server log only, tagged with method/path/status for triage.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, error, message } = this.resolve(exception);

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}: ${this.describe(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${req.method} ${req.originalUrl} -> ${status}: ${JSON.stringify(message)}`);
    }

    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; error: string; message: string | string[] } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();
      if (typeof response === 'string') {
        return { status, error: exception.name, message: response };
      }
      const body = response as { error?: string; message?: string | string[] };
      return {
        status,
        error: body.error ?? exception.name,
        message: body.message ?? exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    // Unknown/unexpected error — never leak details, log full context instead.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again later.',
    };
  }

  private resolvePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): { status: number; error: string; message: string } {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return { status: HttpStatus.CONFLICT, error: 'Conflict', message: `A record with this ${target} already exists.` };
      }
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'The requested resource was not found.' };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'This operation references a record that does not exist.' };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'A database error occurred. Please try again later.',
        };
    }
  }

  private describe(exception: unknown): string {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return `Prisma ${exception.code}: ${exception.message.split('\n').pop()}`;
    }
    if (exception instanceof Error) {
      return exception.message;
    }
    return JSON.stringify(exception);
  }
}
