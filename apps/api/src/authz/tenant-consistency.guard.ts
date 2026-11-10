import { TENANT_HEADER, TENANT_SWITCHED_ERROR } from '@fld/shared';
import {
  ConflictException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Principal } from '../auth/principal.js';
import { ACCOUNT_ROUTE } from './account-route.decorator.js';

interface TenantRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: Principal | null;
}

/**
 * Refuses a request that names another tenant than the session's current one. Tenants are
 * switched per session, so after one browser tab switches, the others would otherwise go on
 * showing one tenant while reading and writing another. Clients that send no tenant header
 * (scripts, the API docs) aren't checked.
 */
@Injectable()
export class TenantConsistencyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      context.getType() !== 'http' ||
      this.reflector.getAllAndOverride<boolean>(ACCOUNT_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const { headers, user } = context.switchToHttp().getRequest<TenantRequest>();
    const expected = headers[TENANT_HEADER];
    if (user && typeof expected === 'string' && expected !== user.context?.tenant.id) {
      throw new ConflictException({
        statusCode: 409,
        error: TENANT_SWITCHED_ERROR,
        message: '当前租户已在其他页面切换，请刷新页面',
      });
    }
    return true;
  }
}
