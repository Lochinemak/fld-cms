import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { NotificationBell } from '@/components/notification-bell';
import { RequireSignIn } from '@/components/require-sign-in';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { ThemeMenu } from '@/components/theme-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { UserMenu } from '@/components/user-menu';
import { currentTenant, setCurrentTenant } from '@/lib/api';
import { meQuery, useMe } from '@/lib/auth';

/** Every signed-in page lives under this layout. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (me.user.mustChangePassword) {
      throw redirect({ to: '/change-password' });
    }
    setCurrentTenant(me.tenant?.id ?? null);
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <RequireSignIn>
      <AppShell />
    </RequireSignIn>
  );
}

function AppShell() {
  const me = useMe();
  const tenantId = me.tenant?.id ?? null;

  // A refetch may reveal that another tab switched the tenant; this page still shows the old one.
  useEffect(() => {
    if (tenantId !== currentTenant()) {
      window.location.reload();
    }
  }, [tenantId]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-vertical:h-4 data-vertical:self-center"
          />
          <TenantSwitcher />
          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
