import {
  createMemberSchema,
  memberStatusSchema,
  updateMemberSchema,
  type Member,
  type MemberStatus,
  type UpdateMemberInput,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Ellipsis, KeyRound, Pencil, UserMinus, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  AccountChoiceFields,
  readAccountChoice,
  type AccountMode,
} from '@/components/account-choice-fields';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DeptSelect } from '@/components/dept-select';
import { FieldError } from '@/components/field-error';
import { OneTimePasswordDialog, type OneTimePassword } from '@/components/one-time-password-dialog';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { StatusBadge, StatusField } from '@/components/status-field';
import { TableMessage } from '@/components/table-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan, useMe } from '@/lib/auth';
import type { DeptNode } from '@/lib/dept-tree';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import {
  PAGE_SIZE,
  STATUS_LABELS,
  createMember,
  formatDate,
  membersQuery,
  refreshSystem,
  removeMember,
  resetMemberPassword,
  rolesQuery,
  updateMember,
  useDeptTree,
} from '@/lib/system';
import { cn } from '@/lib/utils';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  deptId: z.string().optional().catch(undefined),
  status: memberStatusSchema.optional().catch(undefined),
});

export const Route = createFileRoute('/_app/system/members')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="system:member">
      <MembersPage />
    </RequirePermission>
  ),
});

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; member: Member }
  | { kind: 'reset'; member: Member }
  | { kind: 'remove'; member: Member };

const STATUS_FILTER = [
  { value: 'ALL', label: '全部状态' },
  ...memberStatusSchema.options.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
];

function MembersPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { nodes } = useDeptTree();
  const { data, error, isPending } = useQuery(
    membersQuery({ page, keyword: search.keyword, deptId: search.deptId, status: search.status }),
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [secret, setSecret] = useState<OneTimePassword | null>(null);
  const closeDialog = () => setDialog(null);

  // A new filter starts again from the first page.
  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="成员管理"
        description="只列出你的数据范围内的成员；选择部门时包括它的下级部门。"
        actions={
          <Can code="system:member:create">
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <UserPlus />
              添加成员
            </Button>
          </Can>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <DeptFilter nodes={nodes} value={search.deptId} onChange={(deptId) => filter({ deptId })} />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              value={search.keyword}
              placeholder="搜索用户名、姓名或邮箱"
              onSearch={(keyword) => filter({ keyword })}
            />
            <Select
              items={STATUS_FILTER}
              value={search.status ?? 'ALL'}
              onValueChange={(value) =>
                filter({
                  status: value === null || value === 'ALL' ? undefined : (value as MemberStatus),
                })
              }
            >
              <SelectTrigger className="w-32" aria-label="按状态筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending && <TableMessage colSpan={6}>加载中…</TableMessage>}
                {data?.items.length === 0 && <TableMessage colSpan={6}>没有找到成员</TableMessage>}
                {data?.items.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    self={member.userId === me.user.id}
                    onAction={setDialog}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {data && (
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPageChange={(next) =>
                void navigate({ search: (prev) => ({ ...prev, page: next }) })
              }
            />
          )}
        </div>
      </div>
      {dialog?.kind === 'create' && (
        <CreateMemberDialog
          nodes={nodes}
          defaultDeptId={search.deptId ?? nodes[0]?.id ?? null}
          onCreated={setSecret}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditMemberDialog member={dialog.member} nodes={nodes} onClosed={closeDialog} />
      )}
      {dialog?.kind === 'reset' && (
        <ConfirmDialog
          title={`重置「${dialog.member.displayName}」的密码？`}
          description="会生成一个新密码，并让这个账号在所有设备上退出登录。对方用新密码登录后必须先修改密码。"
          confirmLabel="重置密码"
          action={async () => {
            const { password } = await resetMemberPassword(dialog.member.id);
            setSecret({ title: '密码已重置', username: dialog.member.username, password });
          }}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={`将「${dialog.member.displayName}」移出本租户？`}
          description="账号本身不会删除，只是不能再进入这个租户；之后可以再把它添加回来。"
          confirmLabel="移出"
          destructive
          action={async () => {
            await removeMember(dialog.member.id);
            await refreshSystem(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
      {secret && <OneTimePasswordDialog secret={secret} onClosed={() => setSecret(null)} />}
    </div>
  );
}

interface DeptFilterProps {
  nodes: readonly DeptNode[];
  value: string | undefined;
  onChange: (deptId: string | undefined) => void;
}

function DeptFilter({ nodes, value, onChange }: DeptFilterProps) {
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

interface MemberRowProps {
  member: Member;
  /** The signed-in user's own membership, which they can't change here. */
  self: boolean;
  onAction: (state: DialogState) => void;
}

function MemberRow({ member, self, onAction }: MemberRowProps) {
  const canUpdate = useCan('system:member:update');
  const canReset = useCan('system:member:reset-password');
  const canRemove = useCan('system:member:remove');

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2 font-medium">
          {member.displayName}
          {self && <Badge variant="outline">我</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {member.username}
          {member.email && ` · ${member.email}`}
        </div>
      </TableCell>
      <TableCell>{member.dept?.name ?? '—'}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {member.roles.length === 0 && <span className="text-muted-foreground">—</span>}
          {member.roles.map((role) => (
            <Badge key={role.id} variant={role.builtin ? 'default' : 'secondary'}>
              {role.name}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={member.status} />
      </TableCell>
      <TableCell>{formatDate(member.joinedAt)}</TableCell>
      <TableCell>
        {!self && (canUpdate || canReset || canRemove) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={`操作：${member.displayName}`}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {canUpdate && (
                <DropdownMenuItem onClick={() => onAction({ kind: 'edit', member })}>
                  <Pencil />
                  编辑
                </DropdownMenuItem>
              )}
              {canReset && (
                <DropdownMenuItem
                  disabled={member.sharedAccount}
                  onClick={() => onAction({ kind: 'reset', member })}
                >
                  <KeyRound />
                  重置密码
                </DropdownMenuItem>
              )}
              {canReset && member.sharedAccount && (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                  该账号还属于其他租户，只能由本人修改密码。
                </p>
              )}
              {canRemove && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onAction({ kind: 'remove', member })}
                >
                  <UserMinus />
                  移出租户
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

interface DeptFieldProps {
  nodes: readonly DeptNode[];
  value: string | null;
  onChange: (deptId: string) => void;
  error: string | undefined;
}

function DeptField({ nodes, value, onChange, error }: DeptFieldProps) {
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

function RoleChecklist({ value, onChange, error }: RoleChecklistProps) {
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

interface CreateMemberDialogProps {
  nodes: readonly DeptNode[];
  defaultDeptId: string | null;
  /** A new account's generated password, to show once. */
  onCreated: (secret: OneTimePassword) => void;
  onClosed: () => void;
}

function CreateMemberDialog({
  nodes,
  defaultDeptId,
  onCreated,
  onClosed,
}: CreateMemberDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [mode, setMode] = useState<AccountMode>('existing');
  const [deptId, setDeptId] = useState(defaultDeptId);
  const [roleIds, setRoleIds] = useState(() => new Set<string>());
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: createMember,
    onSuccess: async ({ member, initialPassword }) => {
      await refreshSystem(queryClient);
      if (initialPassword) {
        onCreated({
          title: `已添加成员「${member.displayName}」`,
          username: member.username,
          password: initialPassword,
        });
      }
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createMemberSchema.safeParse({
      account: readAccountChoice(form, 'account', mode),
      deptId,
      roleIds: [...roleIds],
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex max-h-[calc(100svh-4rem)] flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>添加成员</DialogTitle>
            <DialogDescription>把已有账号加入本租户，或者为新同事创建账号。</DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
            <AccountChoiceFields
              name="account"
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                setErrors({});
                mutation.reset();
              }}
              errors={errors}
            />
            <DeptField nodes={nodes} value={deptId} onChange={setDeptId} error={errors['deptId']} />
            <RoleChecklist value={roleIds} onChange={setRoleIds} error={errors['roleIds']} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '添加中…' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditMemberDialogProps {
  member: Member;
  nodes: readonly DeptNode[];
  onClosed: () => void;
}

function EditMemberDialog({ member, nodes, onClosed }: EditMemberDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [deptId, setDeptId] = useState(member.dept?.id ?? null);
  const [roleIds, setRoleIds] = useState(() => new Set(member.roles.map(({ id }) => id)));
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (input: UpdateMemberInput) => updateMember(member.id, input),
    onSuccess: async () => {
      await refreshSystem(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Only what changed: the API checks each change against the editor's own rights.
    const sameRoles =
      roleIds.size === member.roles.length && member.roles.every(({ id }) => roleIds.has(id));
    const changes = {
      ...(deptId === (member.dept?.id ?? null) ? {} : { deptId }),
      ...(sameRoles ? {} : { roleIds: [...roleIds] }),
      ...(status === member.status ? {} : { status }),
    };
    if (Object.keys(changes).length === 0) {
      dialog.close();
      return;
    }
    const parsed = updateMemberSchema.safeParse(changes);
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex max-h-[calc(100svh-4rem)] flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>编辑成员「{member.displayName}」</DialogTitle>
            <DialogDescription>
              用户名、姓名和邮箱由账号本人维护；这里只调整它在本租户的部门、角色和状态。
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
            <DeptField nodes={nodes} value={deptId} onChange={setDeptId} error={errors['deptId']} />
            <RoleChecklist value={roleIds} onChange={setRoleIds} error={errors['roleIds']} />
            <StatusField
              value={status}
              onChange={setStatus}
              hint="停用后，对方不能再进入这个租户；它在其他租户的使用不受影响。"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
