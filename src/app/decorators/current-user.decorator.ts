import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Delete this file and use your project's existing @CurrentUser() decorator
 * if you already have one — this is only here so the file set is
 * self-contained. It assumes your JwtAuthGuard attaches the verified user
 * to `request.user`.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
