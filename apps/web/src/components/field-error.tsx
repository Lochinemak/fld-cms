export function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}
