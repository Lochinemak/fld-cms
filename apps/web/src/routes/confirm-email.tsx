import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
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
import { confirmEmail } from '@/lib/auth';

// The page the link mailed to a new email opens, signed in or not. The token only goes out when
// the button is pressed, in a POST, so mail scanners and link previews that open the link don't
// confirm anything.
export const Route = createFileRoute('/confirm-email')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const { token } = Route.useSearch();
  const { t } = useTranslation('auth');
  const mutation = useMutation({ mutationFn: confirmEmail });
  // The API refuses a used, expired or replaced link with a 400, and an address another account
  // got in the meantime with a 409. Either way the link is used up.
  const refused = mutation.error instanceof ApiError && [400, 409].includes(mutation.error.status);
  const error = token ? mutation.error?.message : t('linkIncomplete');

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('confirmEmail')}</CardTitle>
          <CardDescription>{t('confirmEmailDescription')}</CardDescription>
        </CardHeader>
        {mutation.isSuccess ? (
          <CardContent>
            <Alert>
              <CircleCheck />
              <AlertTitle>{t('emailChanged')}</AlertTitle>
              <AlertDescription className="break-all">
                {t('emailNowIs', { email: mutation.data.email })}
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          error && (
            <CardContent>
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </CardContent>
          )
        )}
        <CardFooter className="flex-col gap-3">
          {mutation.isSuccess ? (
            <Link to="/" className={buttonVariants({ className: 'w-full' })}>
              {t('enterApp')}
            </Link>
          ) : (
            <>
              <Button
                className="w-full"
                disabled={!token || refused || mutation.isPending}
                onClick={() => token && mutation.mutate({ token })}
              >
                {mutation.isPending ? t('confirming') : t('confirmEmail')}
              </Button>
              <Link to="/" className={buttonVariants({ variant: 'link', size: 'sm' })}>
                {t('backToApp')}
              </Link>
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
