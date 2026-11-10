import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

  return (
    <AlertDialog {...dialog.rootProps(mutation.isPending)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.error && (
          <Alert variant="destructive">
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '处理中…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
