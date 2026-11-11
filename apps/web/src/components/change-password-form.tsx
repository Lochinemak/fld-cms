import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('auth');
  return (
    <>
      <ErrorAlert error={error} />
      <input type="hidden" name="username" autoComplete="username" value={me.user.username} />
      <PasswordField
        name="currentPassword"
        label={t('currentPassword')}
        autoComplete="current-password"
        error={errors['currentPassword']}
      />
      <PasswordField
        name="newPassword"
        label={t('newPassword')}
        autoComplete="new-password"
        error={errors['newPassword']}
      />
      <PasswordField
        name="confirmPassword"
        label={t('confirmNewPassword')}
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
  const { t } = useTranslation('auth');

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={t('changePasswordTitle')}
      description={t('changePasswordDescription')}
      pending={mutation.isPending}
      submitLabel={t('saveNewPassword')}
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
