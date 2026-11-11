import { EMAIL_CHANGE_MINUTES, updateProfileSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordField } from '@/components/change-password-form';
import { ErrorAlert } from '@/components/error-alert';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { applyMe, updateProfile, useMe } from '@/lib/auth';
import { parseForm, type FieldErrors } from '@/lib/form';

/**
 * The signed-in user's own name and email, over the page they are on. The name is saved at once;
 * a new email takes the password, and a click on the link mailed to it.
 */
export function ProfileDialog({ onClosed }: { onClosed: () => void }) {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const { t } = useTranslation('account');
  // What was typed, if anything: until then the fields show what the account has, which another
  // tab may have changed since this one last asked.
  const [typedName, setTypedName] = useState<string>();
  const [typedEmail, setTypedEmail] = useState<string>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [nameSaved, setNameSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: ({ me, confirmationSentTo }) => {
      applyMe(queryClient, me);
      // Lists and logs name the user too.
      void queryClient.invalidateQueries();
      if (!confirmationSentTo) {
        dialog.close();
      }
    },
  });

  const name = typedName ?? user.displayName;
  const email = typedEmail ?? user.email ?? '';
  const newEmail = email.trim().toLowerCase();
  const emailChanges = newEmail !== (user.email ?? '');
  const sentTo = mutation.data?.confirmationSentTo;

  let emailHint: string = t('emailHint');
  if (emailChanges) {
    emailHint = newEmail ? t('emailHintNew') : t('emailHintCleared');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = parseForm(
      updateProfileSchema,
      {
        displayName: name,
        email,
        ...(emailChanges && { currentPassword: form.get('currentPassword') }),
      },
      setErrors,
    );
    if (!input) {
      return;
    }
    if (input.email !== user.email && !input.currentPassword) {
      setErrors({ currentPassword: t('currentPasswordRequired') });
      return;
    }
    setNameSaved(input.displayName !== user.displayName);
    mutation.mutate(input);
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-sm">
        {sentTo ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('profileTitle')}</DialogTitle>
              <DialogDescription>{t('confirmationPending')}</DialogDescription>
            </DialogHeader>
            <Alert>
              <MailCheck />
              <AlertTitle className="break-all">
                {t('confirmationSentTo', { email: sentTo })}
              </AlertTitle>
              <AlertDescription>
                {t('confirmationDetail', { minutes: EMAIL_CHANGE_MINUTES })}
                {nameSaved && t('nameSaved')}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={dialog.close}>{t('gotIt')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('profileTitle')}</DialogTitle>
              <DialogDescription>{t('profileDescription')}</DialogDescription>
            </DialogHeader>
            <ErrorAlert error={mutation.error} />
            <TextField
              name="username"
              label={t('username')}
              value={user.username}
              autoComplete="username"
              readOnly
              disabled
              hint={t('usernameReadOnly')}
            />
            <TextField
              name="displayName"
              label={t('displayName')}
              value={name}
              onChange={(event) => setTypedName(event.target.value)}
              maxLength={64}
              autoComplete="name"
              error={errors['displayName']}
            />
            <TextField
              name="email"
              type="email"
              label={t('emailOptional')}
              value={email}
              onChange={(event) => setTypedEmail(event.target.value)}
              autoComplete="email"
              error={errors['email']}
              hint={emailHint}
            />
            {emailChanges && (
              <PasswordField
                name="currentPassword"
                label={t('currentPassword', { ns: 'auth' })}
                autoComplete="current-password"
                error={errors['currentPassword']}
              />
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
                {t('cancel', { ns: 'common' })}
              </DialogClose>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? t('saving', { ns: 'common' }) : t('save', { ns: 'common' })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
