import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
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
  const mutation = useMutation({ mutationFn: confirmEmail });
  // The API refuses a used, expired or replaced link with a 400, and an address another account
  // got in the meantime with a 409. Either way the link is used up.
  const refused = mutation.error instanceof ApiError && [400, 409].includes(mutation.error.status);
  const error = token ? mutation.error?.message : '链接不完整，请重新打开邮件里的链接。';

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>确认修改邮箱</CardTitle>
          <CardDescription>确认后，账号的邮箱会改为收到这封邮件的地址。</CardDescription>
        </CardHeader>
        {mutation.isSuccess ? (
          <CardContent>
            <Alert>
              <CircleCheck />
              <AlertTitle>邮箱已修改</AlertTitle>
              <AlertDescription className="break-all">
                账号的邮箱现在是 {mutation.data.email}。
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
              进入系统
            </Link>
          ) : (
            <>
              <Button
                className="w-full"
                disabled={!token || refused || mutation.isPending}
                onClick={() => token && mutation.mutate({ token })}
              >
                {mutation.isPending ? '确认中…' : '确认修改邮箱'}
              </Button>
              <Link to="/" className={buttonVariants({ variant: 'link', size: 'sm' })}>
                返回系统
              </Link>
            </>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
