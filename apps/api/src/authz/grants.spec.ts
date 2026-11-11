import { MODULE_CODES, directoryOf, grantablePermissions, isModuleCode } from '@fld/shared';
import { toPrincipal, type Principal } from '../auth/principal.js';
import { dormantIn, grantableIn } from './grants.js';

const user = {
  id: '7',
  username: 'alice',
  email: null,
  displayName: 'Alice',
  mustChangePassword: false,
  active: true,
  lastTenantId: null,
};

/** A member of a tenant with these modules switched off. */
function memberOf(disabledModules: string[]): Principal {
  return toPrincipal(user, {
    tenant: { id: '2', code: 'acme', name: 'Acme', isSystem: false, disabledModules },
    memberId: '8',
    deptId: '10',
    permissions: [],
    dataScope: { all: true, deptIds: [], self: true },
  });
}

describe('modules', () => {
  it('are the directories a tenant can go without', () => {
    expect(MODULE_CODES).toEqual(expect.arrayContaining(['crm', 'file']));
    expect(MODULE_CODES).not.toContain('system');
    expect(isModuleCode('crm')).toBe(true);
    expect(isModuleCode('system')).toBe(false);
    expect(isModuleCode('crm:customer')).toBe(false);
  });

  it('hold every code filed under them', () => {
    expect(directoryOf('crm:customer:create')).toBe('crm');
    expect(directoryOf('file:library')).toBe('file');
    expect(directoryOf('system')).toBe('system');
  });
});

describe('grantableIn', () => {
  it('leaves out what is under the modules switched off, and nothing else', () => {
    const all = grantableIn(memberOf([]));
    const withoutCustomers = grantableIn(memberOf(['crm']));
    const left = [...all].filter((code) => !withoutCustomers.has(code));

    expect(left).toContain('crm:customer');
    expect(left.map(directoryOf)).toEqual(left.map(() => 'crm'));
    expect([...withoutCustomers].map(directoryOf)).not.toContain('crm');
    expect(withoutCustomers.has('file:library')).toBe(true);
    expect(withoutCustomers.has('system:role')).toBe(true);
  });

  it('takes a module the registry has no more for none', () => {
    expect(grantablePermissions({ isSystem: false, disabledModules: ['gone'] })).toEqual(
      grantablePermissions({ isSystem: false, disabledModules: [] }),
    );
  });

  it('is empty outside any tenant', () => {
    expect(grantableIn(toPrincipal(user, null))).toEqual(new Set());
  });
});

describe('dormantIn', () => {
  it('is what the modules switched off hold back', () => {
    const dormant = dormantIn(memberOf(['file']));

    expect(dormant.has('file:library:share')).toBe(true);
    expect([...dormant].map(directoryOf)).toEqual([...dormant].map(() => 'file'));
    expect(new Set([...dormant, ...grantableIn(memberOf(['file']))])).toEqual(
      grantableIn(memberOf([])),
    );
  });

  it('is empty while every module is on, and outside any tenant', () => {
    expect(dormantIn(memberOf([]))).toEqual(new Set());
    expect(dormantIn(toPrincipal(user, null))).toEqual(new Set());
  });
});
