import type { PlatformAccount } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { OneTimePasswordDialog, type OneTimePassword } from '@/components/one-time-password-dialog';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { StatusBadge } from '@/components/status-field';
import { TableMessage } from '@/components/table-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMe } from '@/lib/auth';
import { formatDateTime } from '@/lib/crm';
import { accountsQuery, resetAccountPassword, unlockAccount } from '@/lib/platform';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/system/accounts')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="system:account">
      <AccountsPage />
    </RequirePermission>
  ),
});

function AccountsPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(accountsQuery({ page, keyword: search.keyword }));
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState<PlatformAccount | null>(null);
  const [unlocking, setUnlocking] = useState<PlatformAccount | null>(null);
  const [secret, setSecret] = useState<OneTimePassword | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['system', 'accounts'] });

  return (
    <div className="space-y-6">
      <PageHeader
        title="账号管理"
        description="平台上的全部登录账号。一个账号可以属于多个租户，在哪个租户都用同一个密码登录。"
      />
      <SearchBox
        value={search.keyword}
        placeholder="搜索用户名、邮箱或姓名"
        onSearch={(keyword) => void navigate({ search: { keyword } })}
      />
      <ErrorAlert error={error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead>所属租户</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最近登录</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={5}>加载中…</TableMessage>}
            {data?.items.length === 0 && <TableMessage colSpan={5}>没有找到账号</TableMessage>}
            {data?.items.map((account) => {
              const self = account.id === me.user.id;
              return (
                <TableRow key={account.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {account.displayName}
                      {self && <Badge variant="outline">我</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {account.username}
                      {account.email && ` · ${account.email}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {account.tenants.length === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {account.tenants.map((tenant) => (
                        <Badge key={tenant.id} variant="secondary">
                          {tenant.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={account.status} />
                      {account.locked && <Badge variant="destructive">已锁定</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {account.lastSignInAt ? formatDateTime(account.lastSignInAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {account.locked && (
                        <Can code="system:account:unlock">
                          <Button variant="ghost" size="sm" onClick={() => setUnlocking(account)}>
                            解锁
                          </Button>
                        </Can>
                      )}
                      {!self && (
                        <Can code="system:account:reset-password">
                          <Button variant="ghost" size="sm" onClick={() => setResetting(account)}>
                            重置密码
                          </Button>
                        </Can>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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
      {resetting && (
        <ConfirmDialog
          title={`重置「${resetting.displayName}」的密码？`}
          description="会生成一个新密码，并让这个账号在所有设备上退出登录；它所在的每个租户都要用新密码登录。对方登录后必须先修改密码。"
          confirmLabel="重置密码"
          action={async () => {
            const { password } = await resetAccountPassword(resetting.id);
            setSecret({ title: '密码已重置', username: resetting.username, password });
            await refresh();
          }}
          onClosed={() => setResetting(null)}
        />
      )}
      {unlocking && (
        <ConfirmDialog
          title={`解锁「${unlocking.displayName}」？`}
          description="连续输错密码太多次，这个账号已被锁定。解锁后本人就能用原来的密码登录，在它所属的每个租户都一样。"
          confirmLabel="解锁"
          action={async () => {
            await unlockAccount(unlocking.id);
            await refresh();
          }}
          onClosed={() => setUnlocking(null)}
        />
      )}
      {secret && <OneTimePasswordDialog secret={secret} onClosed={() => setSecret(null)} />}
    </div>
  );
}
