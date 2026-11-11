import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('auth');
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
          <CardTitle>{t('mfaTitle')}</CardTitle>
          <CardDescription>
            {usingRecoveryCode ? t('mfaRecoveryDescription') : t('mfaCodeDescription')}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            <ErrorAlert error={mutation.error} />
            <div className="space-y-2">
              <Label htmlFor="code">
                {usingRecoveryCode ? t('recoveryCodeLabel') : t('codeLabel')}
              </Label>
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
              {usingRecoveryCode ? t('useAuthenticatorCode') : t('useRecoveryCode')}
            </button>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            {expired ? (
              <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
                {t('signInAgain')}
              </Link>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void signOut().finally(() => window.location.replace('/login'))}
              >
                {t('switchAccount')}
              </Button>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('verifying') : t('verify')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
