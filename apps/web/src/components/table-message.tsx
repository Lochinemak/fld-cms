import type { ReactNode } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';

/** A row across the whole table, for "loading" or "nothing found". */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}
