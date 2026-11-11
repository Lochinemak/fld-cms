import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { currentRequest } from './request-context.js';

/**
 * Nest's logger, writing JSON in production. Every entry written during a request carries its
 * request id, and the user and tenant once known, so one request's lines can be found together.
 */
export class AppLogger extends ConsoleLogger {
  protected override getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
      params?: Record<string, unknown>;
      error?: Error;
    },
  ) {
    const entry = super.getJsonLogObject(message, options);
    const request = currentRequest();
    if (request) {
      entry.requestId ??= request.requestId;
      if (request.userId) entry.userId ??= request.userId;
      if (request.tenantId) entry.tenantId ??= request.tenantId;
    }
    return entry;
  }
}
