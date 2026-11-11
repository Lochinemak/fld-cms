import { changePasswordSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { applyMe, changePassword } from '@/lib/auth';
import { fieldErrors, type FieldErrors } from '@/lib/form';

/** Checks a change-password form and saves it, then calls `onChanged`. */
export function useChangePassword(onChanged: () => Promise<unknown> | void) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('auth');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: async (next) => {
      applyMe(queryClient, next);
      await onChanged();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (form.get('confirmPassword') !== form.get('newPassword')) {
      next['confirmPassword'] = t('passwordsMismatch');
    }
    setErrors(next);
    if (parsed.success && Object.keys(next).length === 0) {
      mutation.mutate(parsed.data);
    }
  }

  return { errors, mutation, submit };
}
