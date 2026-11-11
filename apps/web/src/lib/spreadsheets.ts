import { spreadsheetTaskSchema, type SpreadsheetEntity, type SpreadsheetTask } from '@fld/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, upload } from './api';

const SPREADSHEETS_KEY = ['spreadsheets'] as const;

/** Whether the task is still to finish. */
export const isUnfinished = (task: SpreadsheetTask) =>
  task.status === 'PENDING' || task.status === 'RUNNING';

/** The member's own exports and imports, newest first; asked again every 2s while one runs. */
export const spreadsheetsQuery = queryOptions({
  queryKey: SPREADSHEETS_KEY,
  queryFn: () => api('/spreadsheets', { schema: z.array(spreadsheetTaskSchema) }),
  refetchInterval: (query) => (query.state.data?.some(isUnfinished) ? 2_000 : false),
});

export const refreshSpreadsheets = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: SPREADSHEETS_KEY });

/**
 * Starts an export of the model, filtered by its list page's query. Values go as strings, as
 * the list page's own query string carries them.
 */
export function createExport(entity: SpreadsheetEntity, query: Record<string, unknown>) {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      filters[key] = String(value);
    }
  }
  return api('/spreadsheets/exports', {
    method: 'POST',
    json: { entity, query: filters },
    schema: spreadsheetTaskSchema,
  });
}

/** Uploads a filled-in template to import, all its rows or none. */
export const createImport = (
  entity: SpreadsheetEntity,
  file: File,
  onProgress?: (sent: number) => void,
) =>
  upload(`/spreadsheets/imports?entity=${encodeURIComponent(entity)}`, file, {
    schema: spreadsheetTaskSchema,
    onProgress,
  });

/** The browser downloads these as attachments, with the session cookie. */
export const spreadsheetDownloadUrl = (taskId: string) => `/api/spreadsheets/${taskId}/download`;
export const spreadsheetTemplateUrl = (entity: SpreadsheetEntity) =>
  `/api/spreadsheets/templates/${entity}`;

export const SPREADSHEET_STATUS_LABELS: Record<SpreadsheetTask['status'], string> = {
  PENDING: '排队中',
  RUNNING: '进行中',
  DONE: '完成',
  FAILED: '失败',
};
