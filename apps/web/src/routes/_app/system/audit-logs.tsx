import {
  AUDIT_ACTION_CODES,
  AUDIT_ACTIONS,
  AUDIT_GROUPS,
  AUDIT_TARGETS,
  auditActionSchema,
  type AuditAction,
  type AuditGroup,
  type AuditLog,
} from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { auditLogsQuery, formatAuditTime } from '@/lib/audit';
import { useCan } from '@/lib/auth';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  actor: z.string().optional().catch(undefined),
  action: auditActionSchema.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/system/audit-logs')({
  validateSearch: searchSchema,
  component: AuditLogsRoute,
});

/** The platform's log in the system tenant, and a tenant's own log in any other. */
function AuditLogsRoute() {
  const platform = useCan('system:platform-audit');
  return (
    <RequirePermission code={platform ? 'system:platform-audit' : 'system:audit'}>
      <AuditLogsPage platform={platform} />
    </RequirePermission>
  );
}

const PLATFORM_GROUPS: AuditGroup[] = ['security', 'platform'];
const TENANT_GROUPS: AuditGroup[] = ['security', 'organization', 'data'];

function AuditLogsPage({ platform }: { platform: boolean }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(
    auditLogsQuery({
      page,
      keyword: search.keyword,
      actor: search.actor,
      action: search.action,
      from: search.from,
      to: search.to,
    }),
  );
  const [viewing, setViewing] = useState<AuditLog | null>(null);

  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="审计日志"
        description={
          platform
            ? '谁在什么时候做了什么：登录和密码（包括用不存在的账号尝试登录）、租户和账号的管理、平台设置的修改。记录只能查看，默认保留一年。'
            : '谁在什么时候做了什么：登录和密码、成员和权限的调整，以及删除和转交业务数据。新建和普通编辑不记录；记录只能查看，默认保留一年。'
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchBox
          value={search.keyword}
          placeholder="搜索对象名称"
          onSearch={(keyword) => filter({ keyword })}
        />
        <SearchBox
          value={search.actor}
          placeholder="搜索操作人"
          onSearch={(actor) => filter({ actor })}
        />
        <ActionFilter
          groups={platform ? PLATFORM_GROUPS : TENANT_GROUPS}
          value={search.action}
          onValueChange={(action) => filter({ action })}
        />
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="开始日期"
            className="w-36"
            value={search.from ?? ''}
            max={search.to}
            onChange={(event) => filter({ from: event.target.value || undefined })}
          />
          <span className="text-sm text-muted-foreground">至</span>
          <Input
            type="date"
            aria-label="结束日期"
            className="w-36"
            value={search.to ?? ''}
            min={search.from}
            onChange={(event) => filter({ to: event.target.value || undefined })}
          />
        </div>
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
              <TableHead>时间</TableHead>
              <TableHead>操作人</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableMessage colSpan={7}>加载中…</TableMessage>}
            {data?.items.length === 0 && <TableMessage colSpan={7}>没有找到记录</TableMessage>}
            {data?.items.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{formatAuditTime(log.createdAt)}</TableCell>
                <TableCell>
                  {log.actor ? (
                    <>
                      <div className="font-medium">
                        {log.actor.displayName || log.actor.username}
                      </div>
                      {log.actor.displayName && (
                        <div className="text-xs text-muted-foreground">{log.actor.username}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{AUDIT_ACTIONS[log.action].label}</TableCell>
                <TableCell>
                  {log.target ? (
                    <>
                      <div>{log.target.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {AUDIT_TARGETS[log.target.type]}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Outcome log={log} />
                </TableCell>
                <TableCell className="text-muted-foreground">{log.ip ?? '—'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => setViewing(log)}>
                    详情
                  </Button>
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
      {viewing && <AuditLogDialog log={viewing} onClosed={() => setViewing(null)} />}
    </div>
  );
}

const ALL = '__all__';

/** Narrows the log to one action, offering those of the given groups under their names. */
function ActionFilter({
  groups,
  value,
  onValueChange,
}: {
  groups: AuditGroup[];
  value: AuditAction | undefined;
  onValueChange: (value: AuditAction | undefined) => void;
}) {
  const items = [
    { value: ALL, label: '全部操作' },
    ...AUDIT_ACTION_CODES.map((code) => ({ value: code, label: AUDIT_ACTIONS[code].label })),
  ];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next) =>
        onValueChange(next === null || next === ALL ? undefined : (next as AuditAction))
      }
    >
      <SelectTrigger className="w-40" aria-label="按操作筛选">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>全部操作</SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group}>
            <SelectLabel>{AUDIT_GROUPS[group]}</SelectLabel>
            {AUDIT_ACTION_CODES.filter((code) => AUDIT_ACTIONS[code].group === group).map(
              (code) => (
                <SelectItem key={code} value={code}>
                  {AUDIT_ACTIONS[code].label}
                </SelectItem>
              ),
            )}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function Outcome({ log }: { log: AuditLog }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={log.success ? 'secondary' : 'destructive'}>
        {log.success ? '成功' : '失败'}
      </Badge>
      {log.reason && <span className="text-xs text-muted-foreground">{log.reason}</span>}
    </div>
  );
}

function AuditLogDialog({ log, onClosed }: { log: AuditLog; onClosed: () => void }) {
  const dialog = useMountedDialog(onClosed);
  const actor = log.actor;
  return (
    <Dialog {...dialog.rootProps()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{AUDIT_ACTIONS[log.action].label}</DialogTitle>
          <DialogDescription>{formatAuditTime(log.createdAt)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">操作人</dt>
          <dd>
            {!actor
              ? '—'
              : actor.displayName
                ? `${actor.displayName}（${actor.username}）`
                : actor.username}
          </dd>
          <dt className="text-muted-foreground">对象</dt>
          <dd>{log.target ? `${AUDIT_TARGETS[log.target.type]}：${log.target.name}` : '—'}</dd>
          <dt className="text-muted-foreground">结果</dt>
          <dd>
            <Outcome log={log} />
          </dd>
          <dt className="text-muted-foreground">IP</dt>
          <dd>{log.ip ?? '—'}</dd>
          <dt className="text-muted-foreground">浏览器</dt>
          <dd className="text-xs break-all text-muted-foreground">{log.userAgent ?? '—'}</dd>
        </dl>
        {log.changes.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>内容</TableHead>
                  <TableHead>原来</TableHead>
                  <TableHead>改为</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.changes.map((change) => (
                  <TableRow key={change.field}>
                    <TableCell className="text-muted-foreground">{change.field}</TableCell>
                    <TableCell className="whitespace-normal">{change.from ?? '—'}</TableCell>
                    <TableCell className="whitespace-normal">{change.to ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
