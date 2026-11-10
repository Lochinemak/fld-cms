import { FieldError } from '@/components/field-error';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onValueChange: (value: T | null) => void;
  /** Offered first, to leave the field empty. Without it, a picked value can't be cleared. */
  emptyLabel?: string;
  placeholder?: string;
  error?: string | undefined;
  disabled?: boolean;
}

const EMPTY = '__empty__';

/** A labelled select for a form. Its value lives in state, so read it from there on submit. */
export function SelectField<T extends string>({
  id,
  label,
  options,
  value,
  onValueChange,
  emptyLabel,
  placeholder,
  error,
  disabled,
}: SelectFieldProps<T>) {
  const items: SelectOption[] = emptyLabel
    ? [{ value: EMPTY, label: emptyLabel }, ...options]
    : [...options];
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items}
        value={value ?? (emptyLabel ? EMPTY : null)}
        onValueChange={(next) =>
          onValueChange(next === null || next === EMPTY ? null : (next as T))
        }
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}
