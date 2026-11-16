import type { DeptNode } from '@/lib/dept-tree';
import { cn } from '@/lib/utils';

interface DeptFilterProps {
  nodes: readonly DeptNode[];
  value: string | undefined;
  onChange: (deptId: string | undefined) => void;
}

/** The department tree beside the list, to show one department and those under it. */
export function DeptFilter({ nodes, value, onChange }: DeptFilterProps) {
  const itemClass = (active: boolean) =>
    cn(
      'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
      active && 'bg-muted font-medium',
    );

  return (
    <nav aria-label="按部门筛选" className="space-y-0.5 rounded-lg border p-2">
      <button
        type="button"
        className={itemClass(!value)}
        aria-current={!value || undefined}
        onClick={() => onChange(undefined)}
      >
        全部成员
      </button>
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={itemClass(value === node.id)}
          aria-current={value === node.id || undefined}
          style={{ paddingLeft: `${0.5 + node.depth * 0.75}rem` }}
          onClick={() => onChange(node.id)}
        >
          <span className="truncate">{node.name}</span>
        </button>
      ))}
    </nav>
  );
}
