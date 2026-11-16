import { z } from 'zod';
import { sortOrderSchema } from './pagination.js';

/**
 * The tables whose columns each member arranges for themselves. A table joins by being listed
 * here; its columns are the web app's business (see `useTableView`).
 */
export const TABLE_IDS = ['crm.customer', 'crm.contact'] as const;
export const tableIdSchema = z.enum(TABLE_IDS);
export type TableId = z.infer<typeof tableIdSchema>;

/** The most columns one table's preference names. */
export const TABLE_PREFERENCE_MAX_COLUMNS = 200;

const columnIdSchema = z.string().min(1).max(80);

/** How a member likes one table, in one tenant. */
export const tablePreferenceSchema = z.object({
  /**
   * The columns the member switched on (true) or off (false), by id. A column not named follows
   * the table's default, so columns added later appear as their default says.
   */
  columns: z
    .record(columnIdSchema, z.boolean())
    .refine((columns) => Object.keys(columns).length <= TABLE_PREFERENCE_MAX_COLUMNS, '列太多了'),
  /** The column the member sorts the list by; null for the list's own order. */
  sort: z.object({ column: columnIdSchema, order: sortOrderSchema }).nullable(),
});
export type TablePreference = z.infer<typeof tablePreferenceSchema>;

/** What a member who never changed anything has. */
export const DEFAULT_TABLE_PREFERENCE: TablePreference = { columns: {}, sort: null };
