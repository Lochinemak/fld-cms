import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { useEffect } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { useAppName } from '@/lib/site';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
});

/** Keeps the tab titled with the product's name. */
function Root() {
  const appName = useAppName();
  useEffect(() => {
    document.title = appName;
  }, [appName]);
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">页面不存在</p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        返回首页
      </Link>
    </div>
  );
}
