import { forgotPasswordSchema, PASSWORD_RESET_MINUTES } from '@fld/shared';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('auth');
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
          <CardTitle>{t('forgotPasswordTitle')}</CardTitle>
          <CardDescription>{t('forgotPasswordDescription')}</CardDescription>
        </CardHeader>
        {mutation.isSuccess ? (
          <CardContent>
            <Alert>
              <MailCheck />
              <AlertTitle>{t('resetLinkSentTitle')}</AlertTitle>
              <AlertDescription>
                {t('resetLinkSentDetail', { minutes: PASSWORD_RESET_MINUTES })}
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <form id="forgot-password" onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              <ErrorAlert error={mutation.error} />
              <div className="space-y-2">
                <Label htmlFor="account">{t('accountLabel')}</Label>
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
              {mutation.isPending ? t('sending') : t('sendResetLink')}
            </Button>
          )}
          <Link to="/login" className={buttonVariants({ variant: 'link', size: 'sm' })}>
            {t('backToSignIn')}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
