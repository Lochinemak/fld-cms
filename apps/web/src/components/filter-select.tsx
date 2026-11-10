import type { SelectOption } from '@/components/select-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilterSelectProps<T extends string> {
  /** Names the filter for screen readers, such as 按状态筛选. */
  label: string;
  /** The first option, which turns the filter off, such as 全部状态. */
  allLabel: string;
  options: readonly SelectOption<T>[];
  value: T | undefined;
  onValueChange: (value: T | undefined) => void;
  className?: string;
}

const ALL = '__all__';

/** A select in a list's toolbar that narrows the list to one value. */
export function FilterSelect<T extends string>({
  label,
  allLabel,
  options,
  value,
  onValueChange,
  className = 'w-32',
}: FilterSelectProps<T>) {
  const items: SelectOption[] = [{ value: ALL, label: allLabel }, ...options];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next) =>
        onValueChange(next === null || next === ALL ? undefined : (next as T))
      }
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
