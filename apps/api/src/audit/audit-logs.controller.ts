import { auditLogQuerySchema, type AuditLog, type AuditLogQuery, type Page } from '@fld/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission } from '../authz/permission.policy.js';
import { AuditLogsService } from './audit-logs.service.js';

/** Read only: nobody may change or delete audit records. */
@ApiTags('system')
@Controller('system/audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @RequireAnyPermission('system:audit', 'system:platform-audit')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: auditLogQuerySchema }) query: AuditLogQuery,
  ): Promise<Page<AuditLog>> {
    return this.logs.list(user, query);
  }
}
