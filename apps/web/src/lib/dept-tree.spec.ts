import type { Department } from '@fld/shared';
import { describe, expect, it } from 'vitest';
import { branchIds, buildDeptTree, flattenDeptTree } from './dept-tree';

const dept = (id: string, parentId: string | null): Department => ({
  id,
  parentId,
  name: `部门 ${id}`,
  sort: 0,
  memberCount: 0,
});

// 1 ─ 2 ─ 4
//   └ 3
const DEPTS = [dept('1', null), dept('2', '1'), dept('3', '1'), dept('4', '2')];

describe('buildDeptTree', () => {
  it('nests departments under their parents, in the order given', () => {
    const [root, ...others] = buildDeptTree(DEPTS);
    expect(others).toEqual([]);
    expect(root).toMatchObject({ id: '1', depth: 0 });
    expect(root!.children.map(({ id, depth }) => [id, depth])).toEqual([
      ['2', 1],
      ['3', 1],
    ]);
    expect(root!.children[0]!.children.map(({ id, depth }) => [id, depth])).toEqual([['4', 2]]);
  });

  it('treats a department whose parent is not listed as a root', () => {
    expect(buildDeptTree([dept('5', '99')]).map(({ id, depth }) => [id, depth])).toEqual([
      ['5', 0],
    ]);
  });
});

describe('flattenDeptTree', () => {
  it('lists parents before their children', () => {
    expect(flattenDeptTree(buildDeptTree(DEPTS)).map(({ id }) => id)).toEqual(['1', '2', '4', '3']);
  });
});

describe('branchIds', () => {
  it('holds the department and everything below it', () => {
    const [root] = buildDeptTree(DEPTS);
    expect(branchIds(root!.children[0]!)).toEqual(new Set(['2', '4']));
  });
});
