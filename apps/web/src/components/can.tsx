import type { PermissionCode } from '@fld/shared';
import type { ReactNode } from 'react';
import { useCan } from '@/lib/auth';

interface CanProps {
  /** The permission code from `@fld/shared` that the content needs. */
  code: PermissionCode;
  children: ReactNode;
  /** Shown instead when the permission is missing. */
  fallback?: ReactNode;
}

/**
 * Renders its content only for users who hold the permission in the current tenant. Hiding is a
 * convenience: the API checks the same permission on every request.
 */
export function Can({ code, children, fallback = null }: CanProps) {
  return useCan(code) ? children : fallback;
}
