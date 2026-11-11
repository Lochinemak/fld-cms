import {
  confirmEmailResultSchema,
  meSchema,
  mfaSetupSchema,
  mfaStatusSchema,
  recoveryCodesSchema,
  signInResultSchema,
  signInOptionsSchema,
  signInSessionSchema,
  updateProfileResultSchema,
  type ChangePasswordInput,
  type ConfirmMfaSetupInput,
  type DisableMfaInput,
  type StartMfaSetupInput,
  type VerifyMfaInput,
  type ConfirmEmailInput,
  type ForgotPasswordInput,
  type Me,
  type PermissionCode,
  type ResetPasswordInput,
  type SignInInput,
  type UpdateProfileInput,
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

/** Signs in with a password: the user, or that the code from the authenticator app comes next. */
export const signIn = (input: SignInInput) =>
  api('/auth/sign-in', { method: 'POST', json: input, schema: signInResultSchema });

/** The second step of signing in, password or Logto. */
export const verifyMfa = (input: VerifyMfaInput) =>
  api('/auth/mfa', { method: 'POST', json: input, schema: meSchema });

/** What the sign-in page offers besides a password. */
export const signInOptionsQuery = queryOptions({
  queryKey: ['sign-in-options'],
  queryFn: () => api('/auth/sign-in-options', { schema: signInOptionsSchema }),
  staleTime: 60_000,
});

/** Where the browser goes to sign in with Logto, to land on `redirect` afterwards. */
export const logtoSignInHref = (redirect: string) =>
  `/api/auth/oidc/logto/login?redirect=${encodeURIComponent(redirect)}`;

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

/** Saves the user's own name and email. A new email only asks for the link that confirms it. */
export const updateProfile = (input: UpdateProfileInput) =>
  api('/me/profile', { method: 'PUT', json: input, schema: updateProfileResultSchema });

/** Makes the address a link was mailed to its account's email. */
export const confirmEmail = (input: ConfirmEmailInput) =>
  api('/auth/confirm-email', { method: 'POST', json: input, schema: confirmEmailResultSchema });

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

export const signInSessionsQuery = queryOptions({
  queryKey: ['sign-in-sessions'],
  queryFn: () => api('/me/sessions', { schema: signInSessionSchema.array() }),
  staleTime: 0,
});

/** Signs out one other device. */
export const revokeSignInSession = (id: string) =>
  api(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Signs out every device but this one. */
export const revokeOtherSignInSessions = () => api('/me/sessions', { method: 'DELETE' });

/** A browser and system as people name them, from the user agent: 「Chrome · macOS」. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) {
    return '未知设备';
  }
  const browser =
    [
      ['Edg/', 'Edge'],
      ['OPR/', 'Opera'],
      ['Firefox/', 'Firefox'],
      ['Chrome/', 'Chrome'],
      ['Safari/', 'Safari'],
    ].find(([token]) => userAgent.includes(token!))?.[1] ?? null;
  const system =
    [
      [/iPhone|iPad/, 'iOS'],
      [/Android/, 'Android'],
      [/Windows/, 'Windows'],
      [/Mac OS X|Macintosh/, 'macOS'],
      [/Linux/, 'Linux'],
    ].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1] ?? null;
  return [browser, system].filter(Boolean).join(' · ') || userAgent.slice(0, 40);
}

export const mfaStatusQuery = queryOptions({
  queryKey: ['mfa-status'],
  queryFn: () => api('/me/mfa', { schema: mfaStatusSchema }),
  staleTime: 0,
});

export const startMfaSetup = (input: StartMfaSetupInput) =>
  api('/me/mfa/setup', { method: 'POST', json: input, schema: mfaSetupSchema });

export const confirmMfaSetup = (input: ConfirmMfaSetupInput) =>
  api('/me/mfa/confirm', { method: 'POST', json: input, schema: recoveryCodesSchema });

export const renewRecoveryCodes = () =>
  api('/me/mfa/recovery-codes', { method: 'POST', schema: recoveryCodesSchema });

export const disableMfa = (input: DisableMfaInput) =>
  api('/me/mfa/disable', { method: 'POST', json: input });
