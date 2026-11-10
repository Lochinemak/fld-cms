import type { Principal } from '../auth/principal.js';

export interface DataScopeColumns<W> {
  /** The row's department column. */
  dept?: keyof W & string;
  /** The column holding the user who owns the row. */
  owner?: keyof W & string;
}

/**
 * The Prisma `where` condition limiting a query to the rows the principal's data scope covers in
 * the current tenant: AND it with the query's own conditions. A row is covered when its
 * department is one the scope grants or the principal owns it; a model without either column
 * matches nothing unless the scope is ALL.
 */
export function dataScopeWhere<W extends object>(
  principal: Principal,
  columns: DataScopeColumns<W>,
): W {
  const scope = principal.context?.dataScope;
  if (scope?.all) {
    return {} as W;
  }
  const covered: object[] = [];
  if (scope && columns.dept && scope.deptIds.length > 0) {
    covered.push({ [columns.dept]: { in: scope.deptIds.map(BigInt) } });
  }
  if (scope?.self && columns.owner) {
    covered.push({ [columns.owner]: BigInt(principal.id) });
  }
  // Prisma matches no row for an empty OR.
  return { OR: covered } as W;
}
