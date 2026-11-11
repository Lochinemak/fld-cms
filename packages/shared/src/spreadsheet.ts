import { z } from 'zod';
import { idSchema } from './id.js';
import type { PermissionCode } from './permissions.js';

/**
 * The models a spreadsheet exports or imports, with the permissions each takes. Leaving `import`
 * out, a model is exported only.
 */
export const SPREADSHEET_ENTITIES = {
  'crm.customer': { name: '客户', export: 'crm:customer:export', import: 'crm:customer:import' },
  'crm.contact': { name: '联系人', export: 'crm:contact:export' },
} as const satisfies Record<
  string,
  { name: string; export: PermissionCode; import?: PermissionCode }
>;
export type SpreadsheetEntity = keyof typeof SPREADSHEET_ENTITIES;
export const spreadsheetEntitySchema = z.enum(
  Object.keys(SPREADSHEET_ENTITIES) as [SpreadsheetEntity, ...SpreadsheetEntity[]],
  '不支持导入导出的数据',
);

/** At most this many rows a file imports, all of them or none. */
export const IMPORT_MAX_ROWS = 5000;
/** At most this many rows an export holds. */
export const EXPORT_MAX_ROWS = 100_000;
/** Days an export or an import stays listed, with its file. */
export const SPREADSHEET_KEEP_DAYS = 7;

export const spreadsheetTaskSchema = z.object({
  id: idSchema,
  kind: z.enum(['EXPORT', 'IMPORT']),
  entity: spreadsheetEntitySchema,
  status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']),
  fileName: z.string(),
  /** Whether the file can be downloaded: a finished export. */
  downloadable: z.boolean(),
  rowCount: z.number().int().nullable(),
  error: z.string().nullable(),
  /** The rows of a failed import at fault, by their row number in the sheet. */
  rowErrors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type SpreadsheetTask = z.infer<typeof spreadsheetTaskSchema>;

/** An export: of the model, filtered as its list page is, by that page's query. */
export const createExportSchema = z.object({
  entity: spreadsheetEntitySchema,
  query: z.record(z.string(), z.unknown()).default({}),
});
export type CreateExportInput = z.infer<typeof createExportSchema>;

export const importQuerySchema = z.object({ entity: spreadsheetEntitySchema });
export type ImportQuery = z.infer<typeof importQuerySchema>;
