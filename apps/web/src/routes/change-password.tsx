import { changePasswordSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { FieldError } from '@/components/field-error';
import { RequireSignIn } from '@/components/require-sign-in';
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
import { applyMe, changePassword, meQuery, signOutAndReload, useMe } from '@/lib/auth';
import { fieldErrors, type FieldErrors } from '@/lib/form';

export const Route = createFileRoute('/change-password')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  return (
    <RequireSignIn>
      <ChangePasswordForm />
    </RequireSignIn>
  );
}

function ChangePasswordForm() {
  const me = useMe();
  const forced = me.user.mustChangePassword;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: async (next) => {
      applyMe(queryClient, next);
      await navigate({ to: '/', replace: true });
    },
  });
  const leave = useMutation({ mutationFn: signOutAndReload });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (form.get('confirmPassword') !== form.get('newPassword')) {
      next['confirmPassword'] = '两次输入的新密码不一致';
    }
    setErrors(next);
    if (parsed.success && Object.keys(next).length === 0) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>
            {forced
              ? '你正在使用初始密码或管理员重置的密码，修改后才能继续使用。'
              : '修改后，你在其他设备上的登录会全部失效。'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            {mutation.error && (
              <Alert variant="destructive">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}
            <input type="hidden" name="username" autoComplete="username" value={me.user.username} />
            <PasswordField
              name="currentPassword"
              label="当前密码"
              autoComplete="current-password"
              error={errors['currentPassword']}
            />
            <PasswordField
              name="newPassword"
              label="新密码"
              autoComplete="new-password"
              error={errors['newPassword']}
            />
            <PasswordField
              name="confirmPassword"
              label="确认新密码"
              autoComplete="new-password"
              error={errors['confirmPassword']}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            {forced ? (
              <Button
                type="button"
                variant="ghost"
                disabled={leave.isPending}
                onClick={() => leave.mutate()}
              >
                退出登录
              </Button>
            ) : (
              <Link to="/" className={buttonVariants({ variant: 'ghost' })}>
                取消
              </Link>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存新密码'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

interface PasswordFieldProps {
  name: string;
  label: string;
  autoComplete: string;
  error: string | undefined;
}

function PasswordField({ name, label, autoComplete, error }: PasswordFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={!!error}
      />
      <FieldError message={error} />
    </div>
  );
}
