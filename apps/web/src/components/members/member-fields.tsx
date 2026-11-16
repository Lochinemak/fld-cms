import { useQuery } from '@tanstack/react-query';
import { DeptSelect } from '@/components/dept-select';
import { FieldError } from '@/components/field-error';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { DeptNode } from '@/lib/dept-tree';
import { rolesQuery } from '@/lib/system';

interface DeptFieldProps {
  nodes: readonly DeptNode[];
  value: string | null;
  onChange: (deptId: string) => void;
  error: string | undefined;
}

/** Picks the member's department. */
export function DeptField({ nodes, value, onChange, error }: DeptFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="deptId">部门</Label>
      <DeptSelect
        id="deptId"
        nodes={nodes}
        value={value}
        onValueChange={onChange}
        invalid={!!error}
      />
      {/* A department picked from the list is always valid, so an error means none is. */}
      <FieldError message={error && '请选择部门'} />
    </div>
  );
}

interface RoleChecklistProps {
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  error: string | undefined;
}

/** Ticks the member's roles. */
export function RoleChecklist({ value, onChange, error }: RoleChecklistProps) {
  const { data: roles, isPending } = useQuery(rolesQuery);

  return (
    <div className="space-y-2">
      <Label>角色</Label>
      <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
        {isPending && <p className="text-sm text-muted-foreground">加载中…</p>}
        {roles?.map((role) => (
          <Label key={role.id} className="font-normal">
            <Checkbox
              checked={value.has(role.id)}
              onCheckedChange={(checked) => {
                const next = new Set(value);
                if (checked) {
                  next.add(role.id);
                } else {
                  next.delete(role.id);
                }
                onChange(next);
              }}
            />
            <span className="truncate">{role.name}</span>
            {role.builtin && <Badge variant="secondary">内置</Badge>}
          </Label>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}
