import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditRetentionService } from './audit-retention.service.js';
import { AUDIT_QUEUE, AuditProcessor } from './audit.processor.js';
import { AuditService } from './audit.service.js';

/** The audit log: AuditService records, every module may use it. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AUDIT_QUEUE })],
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsService, AuditRetentionService, AuditProcessor],
  exports: [AuditService],
})
export class AuditModule {}
