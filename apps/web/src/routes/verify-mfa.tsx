import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ErrorAlert } from '@/components/error-alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyMe, signOut, verifyMfa } from '@/lib/auth';
import { safeRedirect } from '@/lib/form';

/**
 * The second step of signing in, for an account with two-step sign-in on: the password sign-in
 * and the Logto callback both send the browser here.
 */
export const Route = createFileRoute('/verify-mfa')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: VerifyMfaPage,
});

function VerifyMfaPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const mutation = useMutation({
    mutationFn: verifyMfa,
    onSuccess: async (me) => {
      applyMe(queryClient, me, { fresh: true });
      await navigate({
        href: me.user.mustChangePassword ? '/change-password' : safeRedirect(search.redirect),
        replace: true,
      });
    },
  });
  const expired = mutation.error && 'status' in mutation.error && mutation.error.status === 401;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    mutation.mutate(usingRecoveryCode ? { recoveryCode: value } : { code: value });
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>两步验证</CardTitle>
          <CardDescription>
            {usingRecoveryCode
              ? '输入一个恢复码。每个恢复码只能用一次。'
              : '打开手机上的验证器应用，输入它显示的 6 位数字。'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            <ErrorAlert error={mutation.error} />
            <div className="space-y-2">
              <Label htmlFor="code">{usingRecoveryCode ? '恢复码' : '验证码'}</Label>
              <Input
                key={usingRecoveryCode ? 'recovery' : 'totp'}
                id="code"
                name="code"
                autoFocus
                autoComplete="one-time-code"
                {...(usingRecoveryCode
                  ? { spellCheck: false }
                  : { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]*' })}
              />
            </div>
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                setUsingRecoveryCode(!usingRecoveryCode);
                mutation.reset();
              }}
            >
              {usingRecoveryCode ? '改用验证器里的验证码' : '手机不在身边？用恢复码'}
            </button>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            {expired ? (
              <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
                重新登录
              </Link>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void signOut().finally(() => window.location.replace('/login'))}
              >
                换个账号
              </Button>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '验证中…' : '验证'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
