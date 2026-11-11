import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { ErrorAlert } from '@/components/error-alert';
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
import { useTranslation } from 'react-i18next';

type FormDialogProps = Omit<ComponentProps<typeof Dialog>, 'children'> & {
  title: ReactNode;
  description: ReactNode;
  /** Why saving failed, shown above the fields. */
  error?: { message: string } | null;
  /** While saving: the buttons are disabled and the submit button shows `pendingLabel`. */
  pending: boolean;
  submitLabel?: string;
  pendingLabel?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** The content's classes, say its width. */
  className?: string;
  /** The form's classes, for a layout other than a simple grid. */
  formClassName?: string;
  /** The fields. */
  children: ReactNode;
};

/**
 * A dialog holding one form: a header, why saving failed, the fields, and a footer to cancel or
 * submit. Spread `useMountedDialog`'s `rootProps` into it.
 */
export function FormDialog({
  title,
  description,
  error,
  pending,
  submitLabel,
  pendingLabel,
  onSubmit,
  className,
  formClassName = 'grid gap-4',
  children,
  ...rootProps
}: FormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog {...rootProps}>
      <DialogContent className={className}>
        <form onSubmit={onSubmit} noValidate className={formClassName}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} />
          {children}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={pending}>
              {t('cancel')}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? (pendingLabel ?? t('saving')) : (submitLabel ?? t('save'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
