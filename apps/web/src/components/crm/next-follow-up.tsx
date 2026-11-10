import { useState } from 'react';
import { formatDateTime } from '@/lib/crm';
import { cn } from '@/lib/utils';

/** When a customer is next due a follow-up, in red once that time has passed. */
export function NextFollowUp({ at }: { at: string | null }) {
  const [now] = useState(Date.now);
  if (!at) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className={cn(Date.parse(at) < now && 'font-medium text-destructive')}>
      {formatDateTime(at)}
    </span>
  );
}
