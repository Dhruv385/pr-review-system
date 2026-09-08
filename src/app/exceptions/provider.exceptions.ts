import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import { AppLogger } from '@shared/logger';

const logger = new AppLogger('ProviderError');

/**
 * Maps a GitHub/GitLab API error (from axios) into a meaningful NestJS
 * exception. Call this from inside a catch block in the provider clients.
 *
 * `provider` is only used for the log/message prefix.
 */
export function mapProviderError(err: unknown, provider: 'GitHub' | 'GitLab'): never {
  const error = err as AxiosError<unknown>;
  const status = error?.response?.status;
  const body = error?.response?.data;

  logger.warn(`${provider} API error (status=${status}): ${JSON.stringify(body)?.slice(0, 500)}`);

  switch (status) {
    case 401:
      throw new UnauthorizedException(
        `${provider} access token is invalid or expired. Please reconnect your ${provider} account.`,
      );
    case 403: {
      // Both GitHub and GitLab return 403 for rate limiting as well as pure access denial.
      const isRateLimited =
        error?.response?.headers?.['x-ratelimit-remaining'] === '0' ||
        error?.response?.headers?.['ratelimit-remaining'] === '0' ||
        /rate limit/i.test(JSON.stringify(body ?? {}));
      if (isRateLimited) {
        throw new ServiceUnavailableException(
          `${provider} API rate limit exceeded. Please try again shortly.`,
        );
      }
      throw new ForbiddenException(
        `Access to this ${provider} resource was denied. It may have been revoked or removed.`,
      );
    }
    case 404:
      throw new NotFoundException(`The requested ${provider} resource no longer exists.`);
    case 422:
      throw new BadRequestException(`${provider} rejected the request as invalid.`);
    case 429:
      throw new ServiceUnavailableException(
        `${provider} API rate limit exceeded. Please try again shortly.`,
      );
    default:
      throw new ServiceUnavailableException(
        `${provider} is temporarily unavailable. Please try again later.`,
      );
  }
}
