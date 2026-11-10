import { resetPasswordSchema } from '@fld/shared';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { PasswordField } from '@/components/change-password-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { resetPassword } from '@/lib/auth';
import { fieldErrors, type FieldErrors } from '@/lib/form';

// The page the mailed link opens. The token only goes out with the new password, in a POST, so
// mail scanners and link previews that open the link don't use it up.
export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({ mutationFn: resetPassword });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({ token, newPassword: form.get('newPassword') });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (form.get('confirmPassword') !== form.get('newPassword')) {
      next['confirmPassword'] = '两次输入的新密码不一致';
    }
    setErrors(next);
    if (parsed.success && Object.keys(next).length === 0) {
      mutation.mutate(parsed.data);
    }
  }

  const linkBroken = !token || !!errors['token'];
  // The API refuses a used, expired or replaced link with a 400.
  const linkRefused = mutation.error instanceof ApiError && mutation.error.status === 400;
  const error = linkBroken ? '链接不完整，请重新打开邮件里的链接。' : mutation.error?.message;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>重设密码</CardTitle>
          <CardDescription>设置新密码后，这个账号在所有设备上的登录都会退出。</CardDescription>
        </CardHeader>
        {mutation.isSuccess ? (
          <CardContent>
            <Alert>
              <CircleCheck />
              <AlertTitle>密码已重设</AlertTitle>
              <AlertDescription>请用新密码登录。</AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <form id="reset-password" onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p>{error}</p>
                    {(linkBroken || linkRefused) && (
                      <Link to="/forgot-password" className="underline underline-offset-4">
                        重新申请重设链接
                      </Link>
                    )}
                  </AlertDescription>
                </Alert>
              )}
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
          </form>
        )}
        <CardFooter className="flex-col gap-3">
          {mutation.isSuccess ? (
            <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
              去登录
            </Link>
          ) : (
            <>
              <Button
                type="submit"
                form="reset-password"
                className="w-full"
                disabled={mutation.isPending || linkBroken}
              >
                {mutation.isPending ? '保存中…' : '保存新密码'}
              </Button>
              <Link to="/login" className={buttonVariants({ variant: 'link', size: 'sm' })}>
                返回登录
              </Link>
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
