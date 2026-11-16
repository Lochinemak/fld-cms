import {
  DEFAULT_TABLE_PREFERENCE,
  tablePreferenceSchema,
  type SortOrder,
  type TableId,
  type TablePreference,
} from '@fld/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from './api';

/**
 * A column of a `DataTable`. `Row` is what a row shows; `SortKey` is what the list's API sorts
 * by.
 */
export interface DataColumn<Row, SortKey extends string = string> {
  /** Names the column in the member's saved preference: keep it once people use the table. */
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** False for a column that is always shown, and so is not offered in the columns menu. */
  hideable?: boolean;
  /** Hidden until the member switches it on. */
  defaultHidden?: boolean;
  /** The API's name for sorting by this column; without it the header is not clickable. */
  sortBy?: SortKey;
  /** Classes of the column's cells. */
  className?: string;
}

/** The sort a list asks its API for. */
export interface TableSort<SortKey extends string = string> {
  sort: SortKey;
  order: SortOrder;
}

type AnyColumn = Pick<DataColumn<never>, 'id' | 'hideable' | 'defaultHidden' | 'sortBy'>;

/** Whether the member sees the column: their own choice, else the column's default. */
export function isColumnShown(column: AnyColumn, preference: TablePreference): boolean {
  if (column.hideable === false) {
    return true;
  }
  return preference.columns[column.id] ?? !column.defaultHidden;
}

/**
 * The preference after the member switched a column on or off. A choice that is the column's
 * default is not kept, so the member follows the default again if it changes; hiding the column
 * the list is sorted by ends the sort.
 */
export function withColumnShown(
  preference: TablePreference,
  column: AnyColumn,
  shown: boolean,
): TablePreference {
  const columns = { ...preference.columns };
  delete columns[column.id];
  if (shown === !!column.defaultHidden) {
    columns[column.id] = shown;
  }
  const sort = !shown && preference.sort?.column === column.id ? null : preference.sort;
  return { columns, sort };
}

/** What a click on a column's header leads to: ascending, then descending, then no sort. */
export function nextSort(preference: TablePreference, columnId: string): TablePreference['sort'] {
  if (preference.sort?.column !== columnId) {
    return { column: columnId, order: 'asc' };
  }
  return preference.sort.order === 'asc' ? { column: columnId, order: 'desc' } : null;
}

/** The saved sort, if its column is still there, sortable and shown. */
export function activeSort<SortKey extends string>(
  columns: readonly Pick<
    DataColumn<never, SortKey>,
    'id' | 'hideable' | 'defaultHidden' | 'sortBy'
  >[],
  preference: TablePreference,
): (TableSort<SortKey> & { column: string }) | null {
  const column = columns.find(({ id }) => id === preference.sort?.column);
  if (!preference.sort || !column?.sortBy || !isColumnShown(column, preference)) {
    return null;
  }
  return { column: column.id, sort: column.sortBy, order: preference.sort.order };
}

export const tablePreferenceQuery = (table: TableId) =>
  queryOptions({
    queryKey: ['preferences', 'tables', table],
    queryFn: () => api(`/preferences/tables/${table}`, { schema: tablePreferenceSchema }),
    // Only this browser changes it, and it puts what it saved here itself.
    staleTime: Infinity,
  });

export const saveTablePreference = (table: TableId, preference: TablePreference) =>
  api(`/preferences/tables/${table}`, { method: 'PUT', json: preference });

/** A table as one member sees it: what `DataTable` and `ColumnsMenu` work from. */
export interface TableView<Row, SortKey extends string = string> {
  /** Every column the table has, shown or not. */
  columns: readonly DataColumn<Row, SortKey>[];
  /** The columns the member sees, in order. */
  visible: readonly DataColumn<Row, SortKey>[];
  isShown: (columnId: string) => boolean;
  setShown: (columnId: string, shown: boolean) => void;
  /** The id and direction of the sorted column, with the API's name for it. */
  sorted: (TableSort<SortKey> & { column: string }) | null;
  /** What to pass the list's API: `{ sort, order }`, or nothing. */
  sort: TableSort<SortKey> | undefined;
  /** Sorts by the column, turns the sort around, then ends it. */
  toggleSort: (columnId: string) => void;
  /** Whether the member changed anything from the defaults. */
  customized: boolean;
  reset: () => void;
  /**
   * False until the saved preference is here. Lists wait for it before asking for rows, so they
   * ask once, in the member's order.
   */
  ready: boolean;
}

/**
 * The member's own view of a table: which columns show and what it is sorted by, kept on the
 * server (so it follows them to any device) for the table registered as `table` in
 * `TABLE_IDS`. Changes show at once and are saved behind; one that cannot be saved is undone.
 */
export function useTableView<Row, SortKey extends string = string>(
  table: TableId,
  columns: readonly DataColumn<Row, SortKey>[],
  /** Called when the sort changes: a list goes back to its first page. */
  onSortChange?: () => void,
): TableView<Row, SortKey> {
  const queryClient = useQueryClient();
  const { queryKey } = tablePreferenceQuery(table);
  const { data, isPending } = useQuery(tablePreferenceQuery(table));
  const preference = data ?? DEFAULT_TABLE_PREFERENCE;

  const change = (next: TablePreference) => {
    queryClient.setQueryData(queryKey, next);
    saveTablePreference(table, next).catch(() => queryClient.invalidateQueries({ queryKey }));
  };
  const columnOf = (columnId: string) => columns.find(({ id }) => id === columnId);
  const sorted = activeSort(columns, preference);

  return {
    columns,
    visible: columns.filter((column) => isColumnShown(column, preference)),
    isShown: (columnId) => {
      const column = columnOf(columnId);
      return column !== undefined && isColumnShown(column, preference);
    },
    setShown: (columnId, shown) => {
      const column = columnOf(columnId);
      if (column && column.hideable !== false) {
        change(withColumnShown(preference, column, shown));
        if (!shown && sorted?.column === columnId) {
          onSortChange?.();
        }
      }
    },
    sorted,
    sort: sorted ? { sort: sorted.sort, order: sorted.order } : undefined,
    toggleSort: (columnId) => {
      if (columnOf(columnId)?.sortBy) {
        change({ ...preference, sort: nextSort(preference, columnId) });
        onSortChange?.();
      }
    },
    customized: Object.keys(preference.columns).length > 0 || preference.sort !== null,
    reset: () => {
      change(DEFAULT_TABLE_PREFERENCE);
      if (sorted) {
        onSortChange?.();
      }
    },
    ready: !isPending,
  };
}
