import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop } from 'lucide-react';
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
          <DialogTitle>登录设备</DialogTitle>
          <DialogDescription>
            这个账号正在这些浏览器和设备上登录。看到不认识的，退出它并修改密码。
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert error={error ?? revoke.error ?? revokeOthers.error} />
        {isPending && <p className="text-sm text-muted-foreground">加载中…</p>}
        <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
          {data?.map((session) => (
            <li key={session.id} className="flex items-center gap-3 p-3">
              <Laptop className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {describeUserAgent(session.userAgent)}
                  {session.current && <Badge variant="secondary">当前设备</Badge>}
                  {session.method === 'logto' && <Badge variant="outline">Logto</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {session.ip ?? '未知 IP'} · 登录于 {formatDateTime(session.createdAt)} · 最近活动{' '}
                  {formatDateTime(session.lastActiveAt)}
                </div>
              </div>
              {!session.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending && revoke.variables === session.id}
                  onClick={() => revoke.mutate(session.id)}
                >
                  退出
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
            {revokeOthers.isPending ? '正在退出…' : '退出其他所有设备'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
