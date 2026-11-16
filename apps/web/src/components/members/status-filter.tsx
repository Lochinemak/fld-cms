import { memberStatusSchema, type MemberStatus } from '@fld/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STATUS_LABELS } from '@/lib/system';

const STATUS_FILTER = [
  { value: 'ALL', label: '全部状态' },
  ...memberStatusSchema.options.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
];

interface StatusFilterProps {
  /** Every status when left out. */
  value: MemberStatus | undefined;
  onChange: (status: MemberStatus | undefined) => void;
}

/** Narrows the list to members of one status. */
export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <Select
      items={STATUS_FILTER}
      value={value ?? 'ALL'}
      onValueChange={(next) =>
        onChange(next === null || next === 'ALL' ? undefined : (next as MemberStatus))
      }
    >
      <SelectTrigger className="w-32" aria-label="按状态筛选">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_FILTER.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
