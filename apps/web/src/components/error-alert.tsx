import { Alert, AlertDescription } from '@/components/ui/alert';

interface ErrorAlertProps {
  /** The error to show; without one, nothing renders. */
  error: { message: string } | null | undefined;
  className?: string;
}

/** A failed query or mutation's message, in a destructive alert. */
export function ErrorAlert({ error, className }: ErrorAlertProps) {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}
