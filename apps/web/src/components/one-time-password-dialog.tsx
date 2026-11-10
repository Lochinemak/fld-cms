import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';

export interface OneTimePassword {
  title: string;
  username: string;
  password: string;
}

interface OneTimePasswordDialogProps {
  secret: OneTimePassword;
  /** Once the dialog has closed: time to forget the password. */
  onClosed: () => void;
}

/**
 * Shows a generated password, which the API returns this once only. It opens when mounted, and
 * only its buttons close it, so a stray click can't lose the password.
 */
export function OneTimePasswordDialog({ secret, onClosed }: OneTimePasswordDialogProps) {
  const dialog = useMountedDialog(onClosed);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <Dialog {...dialog.rootProps()} disablePointerDismissal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret.title}</DialogTitle>
          <DialogDescription>
            密码只显示这一次，关闭后无法再查看。请转交给账号本人，对方登录后必须先修改密码。
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">账号</dt>
          <dd className="font-medium">{secret.username}</dd>
          <dt className="text-muted-foreground">密码</dt>
          <dd className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-2.5 py-1.5 font-mono select-all">
              {secret.password}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copyPassword()}>
              {copy === 'copied' ? <Check /> : <Copy />}
              {copy === 'copied' ? '已复制' : '复制'}
            </Button>
          </dd>
        </dl>
        {copy === 'failed' && (
          <p className="text-sm text-destructive">无法写入剪贴板，请手动选中密码复制。</p>
        )}
        <DialogFooter>
          <DialogClose render={<Button />}>我已记下</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
