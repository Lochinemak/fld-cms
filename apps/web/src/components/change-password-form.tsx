import { FieldError } from '@/components/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from '@/hooks/use-change-password';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useMe } from '@/lib/auth';
import type { FieldErrors } from '@/lib/form';

interface ChangePasswordFieldsProps {
  errors: FieldErrors;
  /** Why saving failed. */
  error: Error | null;
}

/** The fields of a change-password form, named as {@link useChangePassword} reads them. */
export function ChangePasswordFields({ errors, error }: ChangePasswordFieldsProps) {
  const me = useMe();
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="username" autoComplete="username" value={me.user.username} />
      <PasswordField
        name="currentPassword"
        label="当前密码"
        autoComplete="current-password"
        error={errors['currentPassword']}
      />
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
    </>
  );
}

/** Changes the signed-in user's password over the page they are on. */
export function ChangePasswordDialog({ onClosed }: { onClosed: () => void }) {
  const dialog = useMountedDialog(onClosed);
  const { errors, mutation, submit } = useChangePassword(dialog.close);

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>修改后，你在其他设备上的登录会全部失效。</DialogDescription>
          </DialogHeader>
          <ChangePasswordFields errors={errors} error={mutation.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存新密码'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface PasswordFieldProps {
  name: string;
  label: string;
  autoComplete: string;
  error: string | undefined;
}

function PasswordField({ name, label, autoComplete, error }: PasswordFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={!!error}
      />
      <FieldError message={error} />
    </div>
  );
}
