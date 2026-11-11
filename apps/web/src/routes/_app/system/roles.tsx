import {
  createRoleSchema,
  dataScopeSchema,
  grantablePermissions,
  isPermissionCode,
  updateRoleSchema,
  type DataScope,
  type PermissionCode,
  type Role,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldError } from '@/components/field-error';
import { PageHeader } from '@/components/page-header';
import { PermissionTree } from '@/components/permission-tree';
import { RequirePermission } from '@/components/require-permission';
import { TableMessage } from '@/components/table-message';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { hasPermission, useCan, useMe } from '@/lib/auth';
import type { DeptNode } from '@/lib/dept-tree';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import {
  DATA_SCOPES,
  createRole,
  deleteRole,
  refreshSystem,
  rolesQuery,
  updateRole,
  useDeptTree,
} from '@/lib/system';

export const Route = createFileRoute('/_app/system/roles')({
  component: () => (
    <RequirePermission code="system:role">
      <RolesPage />
    </RequirePermission>
  ),
});

/** The role to edit or view; null for a new one. */
interface DialogState {
  role: Role | null;
}

function RolesPage() {
  const queryClient = useQueryClient();
  const canUpdate = useCan('system:role:update');
  const { data: roles, error, isPending } = useQuery(rolesQuery);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [removing, setRemoving] = useState<Role | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色管理"
        description="角色决定成员能用哪些功能（菜单、页面和按钮），以及能看到哪些数据。"
        actions={
          <Can code="system:role:create">
            <Button onClick={() => setDialog({ role: null })}>
              <Plus />
              新建角色
            </Button>
          </Can>
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>角色</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>数据范围</TableHead>
              <TableHead className="text-right">成员数</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={5}>加载中…</TableMessage>}
            {roles?.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {role.name}
                    {role.builtin && <Badge variant="secondary">内置</Badge>}
                  </div>
                  {role.description && (
                    <div className="max-w-sm truncate text-xs text-muted-foreground">
                      {role.description}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{role.code}</TableCell>
                <TableCell>{DATA_SCOPES[role.dataScope].label}</TableCell>
                <TableCell className="text-right tabular-nums">{role.memberCount}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ role })}>
                      {canUpdate && !role.builtin ? '编辑' : '查看'}
                    </Button>
                    {!role.builtin && (
                      <Can code="system:role:delete">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRemoving(role)}
                        >
                          删除
                        </Button>
                      </Can>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog && (
        <RoleDialog
          role={dialog.role}
          readOnly={dialog.role !== null && (dialog.role.builtin || !canUpdate)}
          onClosed={() => setDialog(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`删除角色「${removing.name}」？`}
          description={
            removing.memberCount > 0
              ? `有 ${removing.memberCount} 名成员正在使用这个角色，删除后他们会立即失去它带来的权限。`
              : '删除后不能恢复。'
          }
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteRole(removing.id);
            await refreshSystem(queryClient);
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

interface RoleDialogProps {
  role: Role | null;
  readOnly: boolean;
  onClosed: () => void;
}

function RoleDialog({ role, readOnly, onClosed }: RoleDialogProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const { nodes } = useDeptTree();
  const grantable = me.tenant ? grantablePermissions(me.tenant) : [];
  const [initial] = useState(() => new Set<string>(role?.permissions));
  const [permissions, setPermissions] = useState(
    () => new Set<PermissionCode>(role?.permissions.filter(isPermissionCode)),
  );
  const [dataScope, setDataScope] = useState<DataScope>(role?.dataScope ?? 'SELF');
  const [deptIds, setDeptIds] = useState(() => new Set<string>(role?.deptIds));
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
    const fields = {
      name: form.get('name'),
      description: form.get('description'),
      dataScope,
      deptIds: dataScope === 'CUSTOM' ? [...deptIds] : [],
      permissions: [...permissions],
    };
    if (role) {
      const parsed = updateRoleSchema.safeParse(fields);
      setErrors(parsed.success ? {} : fieldErrors(parsed.error));
      if (parsed.success) {
        mutation.mutate(() => updateRole(role.id, parsed.data));
      }
    } else {
      const parsed = createRoleSchema.safeParse({ ...fields, code: form.get('code') });
      setErrors(parsed.success ? {} : fieldErrors(parsed.error));
      if (parsed.success) {
        mutation.mutate(() => createRole(parsed.data));
      }
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-3xl">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex max-h-[calc(100svh-4rem)] flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {role ? (readOnly ? `角色「${role.name}」` : '编辑角色') : '新建角色'}
            </DialogTitle>
            <DialogDescription>
              {role?.builtin
                ? '内置的管理员角色拥有本租户的全部权限和全部数据，不能修改或删除。'
                : '只能授予你自己拥有的权限，灰色的项不能勾选。'}
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="-mx-4 grid min-h-0 flex-1 gap-6 overflow-y-auto px-4 md:grid-cols-[2fr_3fr]">
            <div className="space-y-4">
              {role ? (
                <div className="space-y-2">
                  <Label>角色编码</Label>
                  <p className="font-mono text-sm">{role.code}</p>
                </div>
              ) : (
                <TextField
                  name="code"
                  label="角色编码"
                  autoComplete="off"
                  error={errors['code']}
                  hint="字母开头，可含数字、_ 和 -，创建后不能修改"
                />
              )}
              <TextField
                name="name"
                label="角色名称"
                autoComplete="off"
                defaultValue={role?.name}
                error={errors['name']}
                disabled={readOnly}
              />
              <div className="space-y-2">
                <Label htmlFor="description">描述（选填）</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={role?.description ?? ''}
                  disabled={readOnly}
                />
                <FieldError message={errors['description']} />
              </div>
              <div className="space-y-3">
                <Label>数据范围</Label>
                <RadioGroup
                  value={dataScope}
                  onValueChange={(value) => setDataScope(value as DataScope)}
                  disabled={readOnly}
                  className="gap-3"
                >
                  {dataScopeSchema.options.map((scope) => (
                    <Label key={scope} className="items-start font-normal">
                      <RadioGroupItem value={scope} />
                      <span className="grid gap-1">
                        <span className="font-medium">{DATA_SCOPES[scope].label}</span>
                        <span className="text-xs text-muted-foreground">
                          {DATA_SCOPES[scope].description}
                        </span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
                {dataScope === 'CUSTOM' && (
                  <DeptChecklist
                    nodes={nodes}
                    value={deptIds}
                    onChange={setDeptIds}
                    disabled={readOnly}
                  />
                )}
                <FieldError message={errors['deptIds']} />
                <p className="text-xs text-muted-foreground">
                  无论哪种范围，成员总能看到自己的数据。
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <Label>功能权限</Label>
              <PermissionTree
                codes={grantable}
                value={permissions}
                onChange={setPermissions}
                canChange={(code) => hasPermission(me, code) || initial.has(code)}
                disabled={readOnly}
              />
              <FieldError message={errors['permissions']} />
            </div>
          </div>
          <DialogFooter>
            {readOnly ? (
              <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
            ) : (
              <>
                <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
                  取消
                </DialogClose>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? '保存中…' : '保存'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeptChecklistProps {
  nodes: readonly DeptNode[];
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
}

/** The departments of a custom data scope: each one counts alone, not its sub-departments. */
function DeptChecklist({ nodes, value, onChange, disabled }: DeptChecklistProps) {
  return (
    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
      {nodes.map((node) => (
        <Label key={node.id} className="font-normal" style={{ paddingLeft: `${node.depth}rem` }}>
          <Checkbox
            checked={value.has(node.id)}
            disabled={disabled}
            onCheckedChange={(checked) => {
              const next = new Set(value);
              if (checked) {
                next.add(node.id);
              } else {
                next.delete(node.id);
              }
              onChange(next);
            }}
          />
          {node.name}
        </Label>
      ))}
    </div>
  );
}
