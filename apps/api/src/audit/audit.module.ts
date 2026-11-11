import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditRetentionService } from './audit-retention.service.js';
import { AuditService } from './audit.service.js';

/** The audit log: AuditService records, every module may use it. */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsService, AuditRetentionService],
  exports: [AuditService],
})
export class AuditModule {}
