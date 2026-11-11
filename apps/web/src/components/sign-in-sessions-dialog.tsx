import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from '@/components/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import {
  describeUserAgent,
  revokeOtherSignInSessions,
  revokeSignInSession,
  signInSessionsQuery,
} from '@/lib/auth';
import { formatDateTime } from '@/lib/crm';

/** Where the signed-in user is signed in, to sign other devices out. */
export function SignInSessionsDialog({ onClosed }: { onClosed: () => void }) {
  const dialog = useMountedDialog(onClosed);
  const { t } = useTranslation('account');
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(signInSessionsQuery);
  const refresh = () => queryClient.invalidateQueries({ queryKey: signInSessionsQuery.queryKey });
  const revoke = useMutation({ mutationFn: revokeSignInSession, onSettled: refresh });
  const revokeOthers = useMutation({ mutationFn: revokeOtherSignInSessions, onSettled: refresh });
  const others = data?.filter((session) => !session.current).length ?? 0;

  return (
    <Dialog {...dialog.rootProps()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sessionsTitle')}</DialogTitle>
          <DialogDescription>{t('sessionsDescription')}</DialogDescription>
        </DialogHeader>
        <ErrorAlert error={error ?? revoke.error ?? revokeOthers.error} />
        {isPending && (
          <p className="text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</p>
        )}
        <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
          {data?.map((session) => (
            <li key={session.id} className="flex items-center gap-3 p-3">
              <Laptop className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {describeUserAgent(session.userAgent)}
                  {session.current && <Badge variant="secondary">{t('currentDevice')}</Badge>}
                  {session.method === 'logto' && <Badge variant="outline">Logto</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('sessionDetail', {
                    ip: session.ip ?? t('unknownIp'),
                    signedInAt: formatDateTime(session.createdAt),
                    lastActiveAt: formatDateTime(session.lastActiveAt),
                  })}
                </div>
              </div>
              {!session.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending && revoke.variables === session.id}
                  onClick={() => revoke.mutate(session.id)}
                >
                  {t('signOutSession')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={others === 0 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {revokeOthers.isPending ? t('signingOutOthers') : t('signOutOthers')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
