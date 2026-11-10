import type { CustomerLevel, CustomerStatus, OpportunityStage } from '@fld/shared';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { CUSTOMER_LEVEL_LABELS, CUSTOMER_STATUS_LABELS, OPPORTUNITY_STAGE_LABELS } from '@/lib/crm';

type Variant = ComponentProps<typeof Badge>['variant'];

const STATUS_VARIANTS: Record<CustomerStatus, Variant> = {
  POTENTIAL: 'outline',
  WON: 'default',
  LOST: 'secondary',
};

const LEVEL_VARIANTS: Record<CustomerLevel, Variant> = {
  A: 'default',
  B: 'secondary',
  C: 'outline',
};

const STAGE_VARIANTS: Record<OpportunityStage, Variant> = {
  QUALIFY: 'outline',
  NEEDS: 'outline',
  PROPOSAL: 'secondary',
  NEGOTIATION: 'secondary',
  WON: 'default',
  LOST: 'destructive',
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{CUSTOMER_STATUS_LABELS[status]}</Badge>;
}

export function CustomerLevelBadge({ level }: { level: CustomerLevel }) {
  return <Badge variant={LEVEL_VARIANTS[level]}>{CUSTOMER_LEVEL_LABELS[level]}</Badge>;
}

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  return <Badge variant={STAGE_VARIANTS[stage]}>{OPPORTUNITY_STAGE_LABELS[stage]}</Badge>;
}
