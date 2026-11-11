import { forgotPasswordSchema, PASSWORD_RESET_MINUTES } from '@fld/shared';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { FieldError } from '@/components/field-error';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPassword } from '@/lib/auth';
import { fieldErrors, type FieldErrors } from '@/lib/form';

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({ mutationFn: forgotPassword });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({ account: form.get('account') });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>忘记密码</CardTitle>
          <CardDescription>
            输入用户名或邮箱，我们会把重设密码的链接发到账号绑定的邮箱。
          </CardDescription>
        </CardHeader>
        {mutation.isSuccess ? (
          <CardContent>
            <Alert>
              <MailCheck />
              <AlertTitle>如果账号存在且绑定了邮箱，邮件已发出</AlertTitle>
              <AlertDescription>
                请在 {PASSWORD_RESET_MINUTES}{' '}
                分钟内打开邮件里的链接设置新密码。没收到的话先看看垃圾邮件；账号没有绑定邮箱的，请联系管理员重置密码。
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <form id="forgot-password" onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              <ErrorAlert error={mutation.error} />
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
            </CardContent>
          </form>
        )}
        <CardFooter className="flex-col gap-3">
          {!mutation.isSuccess && (
            <Button
              type="submit"
              form="forgot-password"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? '发送中…' : '发送重设链接'}
            </Button>
          )}
          <Link to="/login" className={buttonVariants({ variant: 'link', size: 'sm' })}>
            返回登录
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
