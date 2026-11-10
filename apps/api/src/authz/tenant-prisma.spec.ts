import { scopeToTenant } from './tenant-prisma.js';

const tenantId = 2n;

describe('scopeToTenant', () => {
  it('limits reads, updates and deletes to the tenant', () => {
    for (const operation of ['findMany', 'findUnique', 'count', 'updateMany', 'delete']) {
      expect(scopeToTenant(operation, { where: { id: 5n } }, tenantId)).toMatchObject({
        where: { id: 5n, tenantId },
      });
    }
    expect(scopeToTenant('findMany', undefined, tenantId)).toEqual({ where: { tenantId } });
  });

  it('overrides a tenant the caller asked for', () => {
    expect(scopeToTenant('findMany', { where: { tenantId: 3n } }, tenantId)).toEqual({
      where: { tenantId },
    });
  });

  it('creates rows in the tenant', () => {
    expect(scopeToTenant('create', { data: { id: 1n, name: 'Sales' } }, tenantId)).toEqual({
      data: { id: 1n, name: 'Sales', tenantId },
    });
    expect(
      scopeToTenant('createMany', { data: [{ id: 1n }, { id: 2n, tenantId }] }, tenantId),
    ).toEqual({
      data: [
        { id: 1n, tenantId },
        { id: 2n, tenantId },
      ],
    });
  });

  it('refuses to create rows in, or move rows to, another tenant', () => {
    expect(() => scopeToTenant('create', { data: { tenantId: 3n } }, tenantId)).toThrow();
    expect(() =>
      scopeToTenant('create', { data: { tenant: { connect: { id: 3n } } } }, tenantId),
    ).toThrow();
    expect(() =>
      scopeToTenant('updateMany', { where: {}, data: { tenantId: 3n } }, tenantId),
    ).toThrow();
    expect(() =>
      scopeToTenant(
        'upsert',
        { where: { id: 1n }, create: {}, update: { tenantId: 3n } },
        tenantId,
      ),
    ).toThrow();
  });

  it('scopes both sides of an upsert', () => {
    expect(
      scopeToTenant(
        'upsert',
        { where: { id: 1n }, create: { id: 1n }, update: { name: 'B' } },
        tenantId,
      ),
    ).toEqual({
      where: { id: 1n, tenantId },
      create: { id: 1n, tenantId },
      update: { name: 'B' },
    });
  });
});
