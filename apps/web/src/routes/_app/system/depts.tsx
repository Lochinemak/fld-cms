import { createDepartmentSchema, updateDepartmentSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CornerDownRight, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DeptSelect } from '@/components/dept-select';
import { ErrorAlert } from '@/components/error-alert';
import { FieldError } from '@/components/field-error';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { TableMessage } from '@/components/table-message';
import { TextField } from '@/components/text-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan } from '@/lib/auth';
import { branchIds, type DeptNode } from '@/lib/dept-tree';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import { createDept, deleteDept, refreshSystem, updateDept, useDeptTree } from '@/lib/system';

export const Route = createFileRoute('/_app/system/depts')({
  component: () => (
    <RequirePermission code="system:dept">
      <DeptsPage />
    </RequirePermission>
  ),
});

type DialogState = { kind: 'create'; parentId: string } | { kind: 'edit'; dept: DeptNode };

function DeptsPage() {
  const queryClient = useQueryClient();
  const { roots, nodes, error, isPending } = useDeptTree();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [removing, setRemoving] = useState<DeptNode | null>(null);
  const canCreate = useCan('system:dept:create');
  const canUpdate = useCan('system:dept:update');
  const canDelete = useCan('system:dept:delete');
  const hasActions = canCreate || canUpdate || canDelete;
  const root = roots[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="部门管理"
        description="数据范围按这里的层级计算，比如「本部门及下级」。成员数只算直接属于该部门的成员。"
        actions={
          root && (
            <Can code="system:dept:create">
              <Button onClick={() => setDialog({ kind: 'create', parentId: root.id })}>
                <Plus />
                新建部门
              </Button>
            </Can>
          )
        }
      />
      <ErrorAlert error={error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>部门名称</TableHead>
              <TableHead className="text-right">成员数</TableHead>
              <TableHead className="text-right">排序</TableHead>
              {hasActions && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={hasActions ? 4 : 3}>加载中…</TableMessage>}
            {nodes.map((dept) => (
              <TableRow key={dept.id}>
                <TableCell>
                  <span
                    className="flex items-center gap-1.5"
                    style={{ paddingLeft: `${Math.max(dept.depth - 1, 0) * 1.5}rem` }}
                  >
                    {dept.depth > 0 && (
                      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {dept.name}
                    {dept.parentId === null && <Badge variant="secondary">根部门</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{dept.memberCount}</TableCell>
                <TableCell className="text-right tabular-nums">{dept.sort}</TableCell>
                {hasActions && (
                  <TableCell>
                    <div className="flex gap-1">
                      {canCreate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'create', parentId: dept.id })}
                        >
                          新建下级
                        </Button>
                      )}
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'edit', dept })}
                        >
                          编辑
                        </Button>
                      )}
                      {canDelete && dept.parentId !== null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRemoving(dept)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog && <DeptDialog state={dialog} nodes={nodes} onClosed={() => setDialog(null)} />}
      {removing && (
        <ConfirmDialog
          title={`删除部门「${removing.name}」？`}
          description="删除后不能恢复。部门下还有下级部门或成员时不能删除，请先把它们移到其他部门。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteDept(removing.id);
            await refreshSystem(queryClient);
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

interface DeptDialogProps {
  state: DialogState;
  /** Every department, parents first. */
  nodes: readonly DeptNode[];
  onClosed: () => void;
}

function DeptDialog({ state, nodes, onClosed }: DeptDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const editing = state.kind === 'edit' ? state.dept : null;
  const isRoot = editing?.parentId === null;
  const [parentId, setParentId] = useState<string | null>(
    editing ? editing.parentId : state.kind === 'create' ? state.parentId : null,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshSystem(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sort = form.get('sort');
    const fields = {
      name: form.get('name'),
      sort: sort === '' || sort === null ? undefined : Number(sort),
      // The root department stays where it is.
      ...(isRoot ? {} : { parentId: parentId ?? '' }),
    };
    if (editing) {
      const parsed = updateDepartmentSchema.safeParse(fields);
      setErrors(parsed.success ? {} : fieldErrors(parsed.error));
      if (parsed.success) {
        mutation.mutate(() => updateDept(editing.id, parsed.data));
      }
    } else {
      const parsed = createDepartmentSchema.safeParse(fields);
      setErrors(parsed.success ? {} : fieldErrors(parsed.error));
      if (parsed.success) {
        mutation.mutate(() => createDept(parsed.data));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={editing ? '编辑部门' : '新建部门'}
      description={
        editing
          ? '移到其他上级部门时，它的下级部门会一起移过去。'
          : '同一上级下的部门按排序号从小到大排列。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={handleSubmit}
    >
      <TextField
        name="name"
        label="部门名称"
        autoComplete="off"
        defaultValue={editing?.name}
        error={errors['name']}
      />
      {!isRoot && (
        <div className="space-y-2">
          <Label htmlFor="parentId">上级部门</Label>
          <DeptSelect
            id="parentId"
            nodes={nodes}
            value={parentId}
            onValueChange={setParentId}
            disabledIds={editing ? branchIds(editing) : undefined}
            invalid={!!errors['parentId']}
          />
          <FieldError message={errors['parentId'] && '请选择上级部门'} />
        </div>
      )}
      <TextField
        name="sort"
        label="排序号"
        type="number"
        min={0}
        max={9999}
        defaultValue={editing?.sort ?? 0}
        error={errors['sort']}
      />
    </FormDialog>
  );
}
