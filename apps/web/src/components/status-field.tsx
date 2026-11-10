import { memberStatusSchema, type MemberStatus } from '@fld/shared';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { STATUS_LABELS } from '@/lib/system';

interface StatusFieldProps {
  value: MemberStatus;
  onChange: (status: MemberStatus) => void;
  /** What disabling means here. */
  hint: string;
  disabled?: boolean;
}

/** Enabled or disabled, for tenants and members alike. */
export function StatusBadge({ status }: { status: MemberStatus }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'secondary' : 'outline'}>{STATUS_LABELS[status]}</Badge>
  );
}

export function StatusField({ value, onChange, hint, disabled = false }: StatusFieldProps) {
  return (
    <div className="space-y-2">
      <Label>状态</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as MemberStatus)}
        disabled={disabled}
        className="flex gap-6"
      >
        {memberStatusSchema.options.map((status) => (
          <Label key={status} className="font-normal">
            <RadioGroupItem value={status} />
            {STATUS_LABELS[status]}
          </Label>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
