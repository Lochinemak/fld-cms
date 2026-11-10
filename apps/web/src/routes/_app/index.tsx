import { grantablePermissions, permissionDefinition, type PermissionCode } from '@fld/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Can } from '@/components/can';
import { ServiceStatusCard } from '@/components/service-status-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { meQuery, useMe } from '@/lib/auth';

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
  const { tenant } = useMe();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">工作台</h1>
        <p className="text-sm text-muted-foreground">
          {tenant ? `当前租户：${tenant.name}` : '你还没有可用的租户'}
        </p>
      </div>

      {!tenant && (
        <Alert>
          <AlertTitle>暂时不能使用业务功能</AlertTitle>
          <AlertDescription>
            你的账号还不是任何租户的成员，或所在租户已停用。请联系租户管理员把你加入租户。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {tenant && <PermissionsCard isSystemTenant={tenant.isSystem} className="lg:col-span-2" />}
        <ServiceStatusCard />
      </div>
    </div>
  );
}

function PermissionsCard({
  isSystemTenant,
  className,
}: {
  isSystemTenant: boolean;
  className?: string;
}) {
  const codes = grantablePermissions(isSystemTenant);
  const pages = codes.filter((code) => permissionDefinition(code).kind === 'page');

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>我的权限</CardTitle>
        <CardDescription>
          你在当前租户能访问的页面和能使用的操作。页面上的按钮也按同样的权限显示或隐藏。
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {pages.map((page) => (
          <PermissionRow
            key={page}
            page={page}
            elements={codes.filter((code) => permissionDefinition(code).parent === page)}
          />
        ))}
      </CardContent>
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
