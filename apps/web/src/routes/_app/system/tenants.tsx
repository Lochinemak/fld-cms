import {
  SYSTEM_TENANT_ID,
  createTenantSchema,
  resetTenantAdminSchema,
  updateTenantSchema,
  type ResetTenantAdminInput,
  type Tenant,
  type TenantStatus,
  type UpdateTenantInput,
} from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  AccountChoiceFields,
  readAccountChoice,
  type AccountMode,
} from '@/components/account-choice-fields';
import { Can } from '@/components/can';
import { OneTimePasswordDialog, type OneTimePassword } from '@/components/one-time-password-dialog';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { StatusBadge, StatusField } from '@/components/status-field';
import { TableMessage } from '@/components/table-message';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import {
  PAGE_SIZE,
  createTenant,
  formatDate,
  refreshSystem,
  resetTenantAdmin,
  tenantsQuery,
  updateTenant,
} from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/system/tenants')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="system:tenant">
      <TenantsPage />
    </RequirePermission>
  ),
});

type DialogState =
  { kind: 'create' } | { kind: 'edit'; tenant: Tenant } | { kind: 'admin'; tenant: Tenant };

function TenantsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(tenantsQuery({ page, keyword: search.keyword }));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [secret, setSecret] = useState<OneTimePassword | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="租户管理"
        description="平台上的全部租户。每个租户的数据彼此隔离。"
        actions={
          <Can code="system:tenant:create">
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              新建租户
            </Button>
          </Can>
        }
      />
      <SearchBox
        value={search.keyword}
        placeholder="搜索编码或名称"
        onSearch={(keyword) => void navigate({ search: { keyword } })}
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
              <TableHead>编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">成员数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={6}>加载中…</TableMessage>}
            {data?.items.length === 0 && <TableMessage colSpan={6}>没有找到租户</TableMessage>}
            {data?.items.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-mono text-xs">{tenant.code}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {tenant.name}
                    {tenant.id === SYSTEM_TENANT_ID && <Badge variant="secondary">系统</Badge>}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={tenant.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{tenant.memberCount}</TableCell>
                <TableCell>{formatDate(tenant.createdAt)}</TableCell>
                <TableCell>
                  <Can code="system:tenant:update">
                    <div className="flex justify-end gap-1">
                      {tenant.id !== SYSTEM_TENANT_ID && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'admin', tenant })}
                        >
                          重设管理员
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'edit', tenant })}
                      >
                        编辑
                      </Button>
                    </div>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data && (
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          onPageChange={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
        />
      )}
      {dialog?.kind === 'create' && (
        <CreateTenantDialog onCreated={setSecret} onClosed={() => setDialog(null)} />
      )}
      {dialog?.kind === 'edit' && (
        <EditTenantDialog tenant={dialog.tenant} onClosed={() => setDialog(null)} />
      )}
      {dialog?.kind === 'admin' && (
        <ResetAdminDialog
          tenant={dialog.tenant}
          onReset={setSecret}
          onClosed={() => setDialog(null)}
        />
      )}
      {secret && <OneTimePasswordDialog secret={secret} onClosed={() => setSecret(null)} />}
    </div>
  );
}

interface CreateTenantDialogProps {
  /** The administrator's generated password, to show once. */
  onCreated: (secret: OneTimePassword) => void;
  onClosed: () => void;
}

function CreateTenantDialog({ onCreated, onClosed }: CreateTenantDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [mode, setMode] = useState<AccountMode>('new');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: createTenant,
    onSuccess: async ({ tenant, admin }) => {
      await refreshSystem(queryClient);
      if (admin.initialPassword) {
        onCreated({
          title: `租户「${tenant.name}」已创建`,
          username: admin.username,
          password: admin.initialPassword,
        });
      }
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createTenantSchema.safeParse({
      code: form.get('code'),
      name: form.get('name'),
      admin: readAccountChoice(form, 'admin', mode),
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新建租户</DialogTitle>
            <DialogDescription>
              新租户自带一个根部门和内置的管理员角色，由下面的管理员继续添加部门和成员。
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="code"
              label="租户编码"
              autoComplete="off"
              error={errors['code']}
              hint="创建后不能修改"
            />
            <TextField name="name" label="租户名称" autoComplete="off" error={errors['name']} />
          </div>
          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">租户管理员</legend>
            <AccountChoiceFields name="admin" mode={mode} onModeChange={setMode} errors={errors} />
          </fieldset>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTenantDialog({ tenant, onClosed }: { tenant: Tenant; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [status, setStatus] = useState<TenantStatus>(tenant.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const isSystem = tenant.id === SYSTEM_TENANT_ID;
  const mutation = useMutation({
    mutationFn: (input: UpdateTenantInput) => updateTenant(tenant.id, input),
    onSuccess: async () => {
      await refreshSystem(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = updateTenantSchema.safeParse({ name: form.get('name'), status });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>编辑租户</DialogTitle>
            <DialogDescription>
              租户编码 <span className="font-mono">{tenant.code}</span> 不能修改。
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <TextField
            name="name"
            label="租户名称"
            autoComplete="off"
            defaultValue={tenant.name}
            error={errors['name']}
          />
          <StatusField
            value={status}
            onChange={setStatus}
            disabled={isSystem}
            hint={
              isSystem
                ? '系统租户不能停用。'
                : '停用后，成员不能再进入这个租户；重新启用即可恢复，数据都还在。'
            }
          />
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

interface ResetAdminDialogProps {
  tenant: Tenant;
  /** A new administrator's generated password, to show once. */
  onReset: (secret: OneTimePassword) => void;
  onClosed: () => void;
}

function ResetAdminDialog({ tenant, onReset, onClosed }: ResetAdminDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [mode, setMode] = useState<AccountMode>('new');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (input: ResetTenantAdminInput) => resetTenantAdmin(tenant.id, input),
    onSuccess: async (admin) => {
      await refreshSystem(queryClient);
      if (admin.initialPassword) {
        onReset({
          title: `「${tenant.name}」的管理员已重设`,
          username: admin.username,
          password: admin.initialPassword,
        });
      }
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = resetTenantAdminSchema.safeParse({
      admin: readAccountChoice(form, 'admin', mode),
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>重设管理员</DialogTitle>
            <DialogDescription>
              让下面的账号成为「{tenant.name}
              」的管理员，比如原来的管理员离开了。原有的管理员不受影响；这个账号在租户里被停用过的，会重新启用。
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <AccountChoiceFields name="admin" mode={mode} onModeChange={setMode} errors={errors} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '重设中…' : '重设'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
