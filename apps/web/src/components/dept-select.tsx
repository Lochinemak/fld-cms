import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeptNode } from '@/lib/dept-tree';

interface DeptSelectProps {
  id?: string;
  /** Parents first, as `useDeptTree()` lists them. */
  nodes: readonly DeptNode[];
  value: string | null;
  onValueChange: (id: string) => void;
  /** Departments that can't be picked, such as a department's own branch when moving it. */
  disabledIds?: ReadonlySet<string>;
  invalid?: boolean;
}

export function DeptSelect({
  id,
  nodes,
  value,
  onValueChange,
  disabledIds,
  invalid,
}: DeptSelectProps) {
  return (
    <Select
      items={nodes.map((node) => ({ value: node.id, label: node.name }))}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder="选择部门" />
      </SelectTrigger>
      <SelectContent>
        {nodes.map((node) => (
          <SelectItem key={node.id} value={node.id} disabled={disabledIds?.has(node.id)}>
            <span style={{ paddingLeft: `${node.depth}rem` }}>{node.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
