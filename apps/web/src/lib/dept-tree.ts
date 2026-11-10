import type { Department } from '@fld/shared';

export interface DeptNode extends Department {
  depth: number;
  children: DeptNode[];
}

/** The departments as a tree, each level in the order the API lists them. */
export function buildDeptTree(depts: readonly Department[]): DeptNode[] {
  const nodes = new Map<string, DeptNode>(
    depts.map((dept) => [dept.id, { ...dept, depth: 0, children: [] }]),
  );
  const roots: DeptNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    (parent ? parent.children : roots).push(node);
  }
  const setDepth = (level: DeptNode[], depth: number) => {
    for (const node of level) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** Parents before their children: the order of an indented list. */
export function flattenDeptTree(level: readonly DeptNode[]): DeptNode[] {
  return level.flatMap((node) => [node, ...flattenDeptTree(node.children)]);
}

/** The department and every department below it. */
export function branchIds(node: DeptNode): Set<string> {
  return new Set(flattenDeptTree([node]).map(({ id }) => id));
}
