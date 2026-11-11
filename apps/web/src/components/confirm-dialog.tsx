import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Runs on confirming. If it fails, the dialog stays open and shows why. */
  action: () => Promise<unknown>;
  /** Once the dialog has closed, confirmed or not. */
  onClosed: () => void;
}

/** Asks before an action: it opens when mounted, and closes once the action has succeeded. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  action,
  onClosed,
}: ConfirmDialogProps) {
  const dialog = useMountedDialog(onClosed);
  const mutation = useMutation({ mutationFn: action, onSuccess: dialog.close });

  const { t } = useTranslation();
  return (
    <AlertDialog {...dialog.rootProps(mutation.isPending)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={mutation.error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t('working') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
