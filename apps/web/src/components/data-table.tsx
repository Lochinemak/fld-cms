import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TableMessage } from '@/components/table-message';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TableView } from '@/lib/table-view';

interface DataTableProps<Row, SortKey extends string> {
  /** From `useTableView`: the columns the member sees and the sort. */
  view: TableView<Row, SortKey>;
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  isPending: boolean;
  /** What to say when there are no rows, such as 没有找到客户. */
  empty: string;
  /** The buttons at the end of each row; leave out when the user may do nothing to a row. */
  actions?: (row: Row) => ReactNode;
}

/**
 * A list page's table, drawn from column definitions: it shows the columns the member chose
 * (see `ColumnsMenu`), and sorts by a column when its header is clicked.
 *
 * To give a page one: list the table in `TABLE_IDS` (@fld/shared), describe its columns as
 * `DataColumn`s, and pass them through `useTableView` to this and to `ColumnsMenu`. The customer
 * list (`routes/_app/crm/customers/index.tsx`) is the example to copy.
 */
export function DataTable<Row, SortKey extends string>({
  view,
  rows,
  rowKey,
  isPending,
  empty,
  actions,
}: DataTableProps<Row, SortKey>) {
  const { t } = useTranslation();
  const span = view.visible.length + (actions ? 1 : 0);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {view.visible.map((column) => {
              const order = view.sorted?.column === column.id ? view.sorted.order : undefined;
              if (!column.sortBy) {
                return <TableHead key={column.id}>{column.header}</TableHead>;
              }
              const Icon =
                order === 'asc' ? ArrowUp : order === 'desc' ? ArrowDown : ChevronsUpDown;
              return (
                <TableHead
                  key={column.id}
                  aria-sort={
                    order === 'asc' ? 'ascending' : order === 'desc' ? 'descending' : 'none'
                  }
                >
                  <button
                    type="button"
                    className="-mx-2 inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    title={t(
                      order === 'asc'
                        ? 'sortDescending'
                        : order === 'desc'
                          ? 'sortClear'
                          : 'sortAscending',
                    )}
                    onClick={() => view.toggleSort(column.id)}
                  >
                    {column.header}
                    <Icon
                      aria-hidden
                      className={order ? 'size-3.5' : 'size-3.5 text-muted-foreground/60'}
                    />
                  </button>
                </TableHead>
              );
            })}
            {actions && <TableHead className="w-0" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableMessage colSpan={span}>{t('loading')}</TableMessage>
          ) : !rows?.length ? (
            <TableMessage colSpan={span}>{empty}</TableMessage>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {view.visible.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
                {actions && (
                  <TableCell>
                    <div className="flex justify-end gap-1">{actions(row)}</div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The 列 button of a list's toolbar: the member ticks the columns to show, and can go back to
 * the defaults. Columns that are always shown are not listed.
 */
export function ColumnsMenu<Row, SortKey extends string>({
  view,
}: {
  view: TableView<Row, SortKey>;
}) {
  const { t } = useTranslation();
  const choices = view.columns.filter((column) => column.hideable !== false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: 'outline' })}>
        <Columns3 />
        {t('columns')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-48">
        {choices.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={view.isShown(column.id)}
            onCheckedChange={(checked) => view.setShown(column.id, checked)}
          >
            <span className="truncate">{column.header}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!view.customized} onClick={() => view.reset()}>
          {t('columnsReset')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
