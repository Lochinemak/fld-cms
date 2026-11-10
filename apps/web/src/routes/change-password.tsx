import { useMutation } from '@tanstack/react-query';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { ChangePasswordFields } from '@/components/change-password-form';
import { RequireSignIn } from '@/components/require-sign-in';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useChangePassword } from '@/hooks/use-change-password';
import { meQuery, signOutAndReload, useMe } from '@/lib/auth';

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
  const { errors, mutation, submit } = useChangePassword(() =>
    navigate({ to: '/', replace: true }),
  );
  const leave = useMutation({ mutationFn: signOutAndReload });

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
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            <ChangePasswordFields errors={errors} error={mutation.error} />
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
