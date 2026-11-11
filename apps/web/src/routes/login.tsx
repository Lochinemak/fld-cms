import { logtoSignInErrors, signInSchema, type LogtoSignInError } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { FieldError } from '@/components/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { applyMe, logtoSignInHref, meQuery, signIn, signInOptionsQuery } from '@/lib/auth';
import { fieldErrors, safeRedirect, type FieldErrors } from '@/lib/form';
import { useAppName } from '@/lib/site';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({
    redirect: z.string().optional(),
    // Why signing in with Logto ended back here.
    error: z.string().optional().catch(undefined),
  }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) {
      throw redirect({ href: safeRedirect(search.redirect) });
    }
  },
  component: LoginPage,
});

function logtoErrorMessage(code: string | undefined, appName: string): string | undefined {
  const messages = logtoSignInErrors(appName);
  return code !== undefined && Object.hasOwn(messages, code)
    ? messages[code as LogtoSignInError]
    : undefined;
}

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const options = useQuery(signInOptionsQuery);
  const appName = useAppName();
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: async (me) => {
      applyMe(queryClient, me, { fresh: true });
      await navigate({
        href: me.user.mustChangePassword ? '/change-password' : safeRedirect(search.redirect),
        replace: true,
      });
    },
  });

  // What Logto's sign-in came back with stays until the form is used.
  const failure =
    mutation.error?.message ??
    (mutation.isIdle ? logtoErrorMessage(search.error, appName) : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({
      account: form.get('account'),
      password: form.get('password'),
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 {appName}</CardTitle>
          <CardDescription>用用户名或邮箱登录，进入你上次使用的租户</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="account">用户名或邮箱</Label>
              <Input
                id="account"
                name="account"
                autoComplete="username"
                autoFocus
                aria-invalid={!!errors['account']}
              />
              <FieldError message={errors['account']} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">密码</Label>
                <Link
                  to="/forgot-password"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  忘记密码？
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors['password']}
              />
              <FieldError message={errors['password']} />
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? '登录中…' : '登录'}
            </Button>
            {options.data?.logto && (
              <>
                <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  或
                  <div className="h-px flex-1 bg-border" />
                </div>
                <a
                  href={logtoSignInHref(safeRedirect(search.redirect))}
                  className={buttonVariants({ variant: 'outline', className: 'w-full' })}
                >
                  使用 Logto 登录
                </a>
              </>
            )}
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
