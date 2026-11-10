import type { PermissionCode } from '@fld/shared';
import { Link } from '@tanstack/react-router';
import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Can } from '@/components/can';
import { buttonVariants } from '@/components/ui/button';

/**
 * A page for the users who hold its permission; anyone else who opens its address learns why
 * it stays closed. The API checks the same permission on every request.
 */
export function RequirePermission({
  code,
  children,
}: {
  code: PermissionCode;
  children: ReactNode;
}) {
  return (
    <Can code={code} fallback={<Forbidden />}>
      {children}
    </Can>
  );
}

function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <ShieldX className="size-10 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">无权访问</h1>
        <p className="text-sm text-muted-foreground">
          你在当前租户没有这个页面的权限。如需使用，请联系租户管理员。
        </p>
      </div>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        返回工作台
      </Link>
    </div>
  );
}
