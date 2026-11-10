import { grantablePermissions, permissionDefinition, type PermissionCode } from '@fld/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Can } from '@/components/can';
import { PageHeader } from '@/components/page-header';
import { ServiceStatusCard } from '@/components/service-status-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Workbench } from '@/components/workbench';
import { hasPermission, meQuery, useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/')({
  beforeLoad: async ({ context }) => {
    // The system tenant has no workbench: it only manages tenants.
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me?.tenant?.isSystem) {
      throw redirect({ to: '/system/tenants', replace: true });
    }
  },
  component: HomePage,
});

function HomePage() {
  const me = useMe();
  const { tenant } = me;

  if (!tenant) {
    return (
      <div className="space-y-6">
        <PageHeader title="工作台" description="你还没有可用的租户" />
        <Alert>
          <AlertTitle>暂时不能使用业务功能</AlertTitle>
          <AlertDescription>
            你的账号还不是任何租户的成员，或所在租户已停用。请联系租户管理员把你加入租户。
          </AlertDescription>
        </Alert>
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <ServiceStatusCard />
        </div>
      </div>
    );
  }

  return (
    <Workbench
      key={`${me.user.id}:${tenant.id}`}
      userId={me.user.id}
      tenantId={tenant.id}
      description={`当前租户：${tenant.name}`}
      cards={{
        permissions: {
          title: '我的权限',
          content: <PermissionsCard isSystemTenant={tenant.isSystem} />,
        },
        'service-status': { title: '服务状态', content: <ServiceStatusCard /> },
      }}
    />
  );
}

/** Folded to a count at first: the full list is long, and most days nobody needs it. */
function PermissionsCard({ isSystemTenant }: { isSystemTenant: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const codes = grantablePermissions(isSystemTenant);
  const pages = codes.filter((code) => permissionDefinition(code).kind === 'page');
  const granted = (kind: 'page' | 'element') =>
    codes.filter((code) => permissionDefinition(code).kind === kind && hasPermission(me, code))
      .length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>我的权限</CardTitle>
        <CardDescription>
          你在当前租户能访问 {granted('page')} 个页面、使用 {granted('element')}{' '}
          个操作。页面上的按钮也按同样的权限显示或隐藏。
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收起' : '展开'}
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        </CardAction>
      </CardHeader>
      {open && (
        <CardContent className="divide-y">
          {pages.map((page) => (
            <PermissionRow
              key={page}
              page={page}
              elements={codes.filter((code) => permissionDefinition(code).parent === page)}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function PermissionRow({ page, elements }: { page: PermissionCode; elements: PermissionCode[] }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex w-40 shrink-0 items-center gap-2 text-sm font-medium">
        {permissionDefinition(page).name}
        <Can code={page} fallback={<Badge variant="outline">无权访问</Badge>}>
          <Badge variant="secondary">可访问</Badge>
        </Can>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {elements.map((code) => (
          <Can
            key={code}
            code={code}
            fallback={
              <Badge variant="outline" className="text-muted-foreground line-through">
                {permissionDefinition(code).name}
              </Badge>
            }
          >
            <Badge>{permissionDefinition(code).name}</Badge>
          </Can>
        ))}
      </div>
    </div>
  );
}
