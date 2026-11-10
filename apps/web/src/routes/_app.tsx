import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { RequireSignIn } from '@/components/require-sign-in';
import { TenantSwitcher } from '@/components/tenant-switcher';
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
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-6">
          <Link to="/" className="shrink-0 font-semibold">
            FLD CRM
          </Link>
          <TenantSwitcher />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
