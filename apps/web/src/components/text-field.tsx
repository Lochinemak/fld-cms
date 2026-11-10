import type { ComponentProps } from 'react';
import { FieldError } from '@/components/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TextFieldProps extends ComponentProps<typeof Input> {
  name: string;
  label: string;
  error?: string | undefined;
  /** A note under the field while it has no error. */
  hint?: string;
}

export function TextField({ name, label, error, hint, ...props }: TextFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!error} {...props} />
      {error ? (
        <FieldError message={error} />
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
