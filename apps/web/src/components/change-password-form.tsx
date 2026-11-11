import { ErrorAlert } from '@/components/error-alert';
import { FieldError } from '@/components/field-error';
import { FormDialog } from '@/components/form-dialog';
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
      <ErrorAlert error={error} />
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
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title="修改密码"
      description="修改后，你在其他设备上的登录会全部失效。"
      pending={mutation.isPending}
      submitLabel="保存新密码"
      onSubmit={submit}
      className="sm:max-w-sm"
    >
      <ChangePasswordFields errors={errors} error={mutation.error} />
    </FormDialog>
  );
}

interface PasswordFieldProps {
  name: string;
  label: string;
  autoComplete: string;
  error: string | undefined;
}

export function PasswordField({ name, label, autoComplete, error }: PasswordFieldProps) {
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
