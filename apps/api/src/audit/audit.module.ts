import {
  Global,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditRetentionService } from './audit-retention.service.js';
import { AuditService } from './audit.service.js';
import { requestInfo } from './request-info.js';

/** The audit log: AuditService records, every module may use it. */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsService, AuditRetentionService],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestInfo).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
