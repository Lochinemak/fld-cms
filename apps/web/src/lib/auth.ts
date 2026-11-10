import {
  meSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type Me,
  type PermissionCode,
  type ResetPasswordInput,
  type SignInInput,
} from '@fld/shared';
import { queryOptions, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, setCurrentTenant } from './api';

export const meQuery = queryOptions({
  queryKey: ['me'],
  // null: signed out.
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api('/me', { schema: meSchema });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },
  staleTime: 60_000,
});

export const signIn = (input: SignInInput) =>
  api('/auth/sign-in', { method: 'POST', json: input, schema: meSchema });

export const signOut = () => api('/auth/sign-out', { method: 'POST' });

/** Signs out and reloads the app, so nothing of the previous user stays in memory. */
export async function signOutAndReload(): Promise<void> {
  await signOut().catch(() => undefined);
  window.location.replace('/login');
}

/** For a session that ended elsewhere: reload into sign-in, then come back here. */
export function reloadToSignIn(): void {
  const { pathname, search, hash } = window.location;
  window.location.replace(`/login?redirect=${encodeURIComponent(pathname + search + hash)}`);
}

export const switchTenant = (tenantId: string) =>
  api('/me/tenant', { method: 'PUT', json: { tenantId }, schema: meSchema });

export const changePassword = (input: ChangePasswordInput) =>
  api('/me/password', { method: 'PUT', json: input, schema: meSchema });

export const forgotPassword = (input: ForgotPasswordInput) =>
  api('/auth/forgot-password', { method: 'POST', json: input });

export const resetPassword = (input: ResetPasswordInput) =>
  api('/auth/reset-password', { method: 'POST', json: input });

/**
 * Makes `me` the signed-in state. With `fresh`, drops everything cached for the previous user or
 * tenant first.
 */
export function applyMe(queryClient: QueryClient, me: Me | null, { fresh = false } = {}): void {
  if (fresh) {
    queryClient.clear();
  }
  setCurrentTenant(me?.tenant?.id ?? null);
  queryClient.setQueryData(meQuery.queryKey, me);
}

/** The signed-in user. Only for pages under the signed-in layout, which guarantees one. */
export function useMe(): Me {
  const { data } = useSuspenseQuery(meQuery);
  if (!data) {
    throw new Error('useMe() needs a signed-in user.');
  }
  return data;
}

/** Whether the user holds the permission in the current tenant. */
export function hasPermission(me: Me, code: PermissionCode): boolean {
  return !me.user.mustChangePassword && me.permissions.includes(code);
}

export function useCan(code: PermissionCode): boolean {
  return hasPermission(useMe(), code);
}
