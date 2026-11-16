import { DEFAULT_TABLE_PREFERENCE, type TablePreference } from '@fld/shared';
import { describe, expect, it } from 'vitest';
import { activeSort, isColumnShown, nextSort, withColumnShown } from './table-view';

const name = { id: 'name', hideable: false, sortBy: 'name' } as const;
const level = { id: 'level', sortBy: 'level' } as const;
const phone = { id: 'phone', defaultHidden: true } as const;
const columns = [name, level, phone];

const preference = (
  shown: TablePreference['columns'] = {},
  sort: TablePreference['sort'] = null,
): TablePreference => ({ columns: shown, sort });

describe('isColumnShown', () => {
  it('follows the column default until the member chooses', () => {
    expect(isColumnShown(level, DEFAULT_TABLE_PREFERENCE)).toBe(true);
    expect(isColumnShown(phone, DEFAULT_TABLE_PREFERENCE)).toBe(false);
    expect(isColumnShown(level, preference({ level: false }))).toBe(false);
    expect(isColumnShown(phone, preference({ phone: true }))).toBe(true);
  });

  it('always shows a column that cannot be hidden', () => {
    expect(isColumnShown(name, preference({ name: false }))).toBe(true);
  });
});

describe('withColumnShown', () => {
  it('keeps only choices that differ from the default', () => {
    const hidden = withColumnShown(DEFAULT_TABLE_PREFERENCE, level, false);
    expect(hidden.columns).toEqual({ level: false });
    expect(withColumnShown(hidden, level, true).columns).toEqual({});

    const shown = withColumnShown(DEFAULT_TABLE_PREFERENCE, phone, true);
    expect(shown.columns).toEqual({ phone: true });
    expect(withColumnShown(shown, phone, false).columns).toEqual({});
  });

  it('ends the sort when its column is hidden, and no other', () => {
    const sorted = preference({}, { column: 'level', order: 'desc' });
    expect(withColumnShown(sorted, level, false).sort).toBeNull();
    expect(withColumnShown(sorted, phone, true).sort).toEqual({ column: 'level', order: 'desc' });
  });

  it('leaves the preference it was given alone', () => {
    const before = preference({ level: false });
    withColumnShown(before, level, true);
    expect(before.columns).toEqual({ level: false });
  });
});

describe('nextSort', () => {
  it('goes ascending, descending, then back to no sort', () => {
    const ascending = nextSort(DEFAULT_TABLE_PREFERENCE, 'level');
    expect(ascending).toEqual({ column: 'level', order: 'asc' });
    const descending = nextSort(preference({}, ascending), 'level');
    expect(descending).toEqual({ column: 'level', order: 'desc' });
    expect(nextSort(preference({}, descending), 'level')).toBeNull();
  });

  it('starts ascending on another column', () => {
    expect(nextSort(preference({}, { column: 'level', order: 'desc' }), 'name')).toEqual({
      column: 'name',
      order: 'asc',
    });
  });
});

describe('activeSort', () => {
  it('names the sort as the API knows it', () => {
    expect(activeSort(columns, preference({}, { column: 'level', order: 'desc' }))).toEqual({
      column: 'level',
      sort: 'level',
      order: 'desc',
    });
    expect(activeSort(columns, DEFAULT_TABLE_PREFERENCE)).toBeNull();
  });

  it('ignores a saved sort whose column is gone, not sortable or hidden', () => {
    expect(activeSort(columns, preference({}, { column: 'gone', order: 'asc' }))).toBeNull();
    expect(
      activeSort(columns, preference({ phone: true }, { column: 'phone', order: 'asc' })),
    ).toBeNull();
    expect(
      activeSort(columns, preference({ level: false }, { column: 'level', order: 'asc' })),
    ).toBeNull();
  });
});
