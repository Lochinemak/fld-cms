import type { ComponentProps } from 'react';
import { FieldError } from '@/components/field-error';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface TextareaFieldProps extends ComponentProps<typeof Textarea> {
  name: string;
  label: string;
  error?: string | undefined;
}

export function TextareaField({ name, label, error, ...props }: TextareaFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} aria-invalid={!!error} {...props} />
      <FieldError message={error} />
    </div>
  );
}
