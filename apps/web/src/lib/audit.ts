import { auditLogPageSchema, type AuditAction } from '@fld/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { listPath } from './system';

export interface AuditLogListParams {
  page: number;
  /** Matches the object's name. */
  keyword?: string;
  /** Matches the username or name of whoever did it. */
  actor?: string;
  action?: AuditAction;
  /** The first and the last day as `date` inputs give them, both included. */
  from?: string;
  to?: string;
}

export const auditLogsQuery = (params: AuditLogListParams) =>
  queryOptions({
    queryKey: ['system', 'audit-logs', params],
    queryFn: () =>
      api(
        listPath('/system/audit-logs', {
          ...params,
          from: params.from && startOfDay(params.from),
          to: params.to && startOfDay(params.to, 1),
        }),
        { schema: auditLogPageSchema },
      ),
    placeholderData: keepPreviousData,
  });

/** A record's time to the second, in the browser's time zone. */
export function formatAuditTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Where a day, or one some days later, starts in the browser's time zone, as an ISO time. */
function startOfDay(date: string, daysLater = 0): string {
  const start = new Date(`${date}T00:00`);
  start.setDate(start.getDate() + daysLater);
  return start.toISOString();
}
