import { toPrincipal, type DataScopeGrant, type Principal } from '../auth/principal.js';
import { dataScopeWhere } from './data-scope.js';

interface CustomerWhere {
  deptId?: unknown;
  ownerId?: unknown;
  OR?: unknown;
}

function principal(dataScope: DataScopeGrant | null): Principal {
  const user = {
    id: '7',
    username: 'alice',
    email: null,
    displayName: 'Alice',
    mustChangePassword: false,
    active: true,
    lastTenantId: null,
  };
  const context = dataScope && {
    tenant: { id: '2', code: 'acme', name: 'Acme', isSystem: false, disabledModules: [] },
    memberId: '8',
    deptId: '10',
    permissions: [],
    dataScope,
  };
  return toPrincipal(user, context);
}

const columns = { dept: 'deptId', owner: 'ownerId' } as const;

describe('dataScopeWhere', () => {
  it('adds no condition for the ALL scope', () => {
    expect(
      dataScopeWhere<CustomerWhere>(principal({ all: true, deptIds: [], self: true }), columns),
    ).toEqual({});
  });

  it('covers the granted departments and the rows the user owns', () => {
    const where = dataScopeWhere<CustomerWhere>(
      principal({ all: false, deptIds: ['10', '11'], self: true }),
      columns,
    );
    expect(where).toEqual({ OR: [{ deptId: { in: [10n, 11n] } }, { ownerId: 7n }] });
  });

  it('covers only owned rows when no department is granted', () => {
    expect(
      dataScopeWhere<CustomerWhere>(principal({ all: false, deptIds: [], self: true }), columns),
    ).toEqual({ OR: [{ ownerId: 7n }] });
  });

  it('ignores a grant the model has no column for', () => {
    expect(
      dataScopeWhere<CustomerWhere>(principal({ all: false, deptIds: ['10'], self: true }), {
        owner: 'ownerId',
      }),
    ).toEqual({ OR: [{ ownerId: 7n }] });
  });

  it('matches nothing outside any tenant', () => {
    expect(dataScopeWhere<CustomerWhere>(principal(null), columns)).toEqual({ OR: [] });
  });
});
