import {
  createOpportunitySchema,
  opportunityStageSchema,
  updateOpportunitySchema,
  type Opportunity,
  type OpportunityStage,
} from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { SelectField } from '@/components/select-field';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import {
  OPPORTUNITY_STAGE_LABELS,
  createOpportunity,
  refreshCrm,
  updateOpportunity,
} from '@/lib/crm';
import { parseForm, type FieldErrors } from '@/lib/form';

const STAGES = opportunityStageSchema.options.map((value) => ({
  value,
  label: OPPORTUNITY_STAGE_LABELS[value],
}));

interface OpportunityFormDialogProps {
  /** The customer the opportunity is with. */
  customerId: string;
  /** The opportunity to edit; without one, the dialog creates one with the customer. */
  opportunity?: Opportunity;
  onClosed: () => void;
}

export function OpportunityFormDialog({
  customerId,
  opportunity,
  onClosed,
}: OpportunityFormDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [stage, setStage] = useState<OpportunityStage>(opportunity?.stage ?? 'QUALIFY');
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshCrm(queryClient);
      dialog.close();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      name: form.get('name'),
      amount: String(form.get('amount') ?? '').trim(),
      stage,
      expectedCloseDate: form.get('expectedCloseDate') || null,
      remark: form.get('remark'),
    };
    if (opportunity) {
      const input = parseForm(updateOpportunitySchema, values, setErrors);
      if (input) {
        mutation.mutate(() => updateOpportunity(opportunity.id, input));
      }
    } else {
      const input = parseForm(createOpportunitySchema, { ...values, customerId }, setErrors);
      if (input) {
        mutation.mutate(() => createOpportunity(input));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={opportunity ? '编辑商机' : '新建商机'}
      description={
        opportunity ? `修改「${opportunity.name}」。` : '新商机由你负责，归入你所在的部门。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={submit}
    >
      <TextField
        name="name"
        label="商机名称"
        defaultValue={opportunity?.name}
        error={errors.name}
        autoFocus
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="amount"
          label="金额（元）"
          inputMode="decimal"
          defaultValue={opportunity?.amount}
          error={errors.amount}
          required
        />
        <TextField
          name="expectedCloseDate"
          label="预计成交日期"
          type="date"
          defaultValue={opportunity?.expectedCloseDate ?? ''}
          error={errors.expectedCloseDate}
        />
      </div>
      <div className="space-y-1">
        <SelectField
          id="opportunity-stage"
          label="阶段"
          options={STAGES}
          value={stage}
          onValueChange={(next) => next && setStage(next)}
          error={errors.stage}
        />
        <p className="text-xs text-muted-foreground">改为「赢单」时，客户状态会一起改为已成交。</p>
      </div>
      <TextareaField
        name="remark"
        label="备注"
        rows={2}
        defaultValue={opportunity?.remark ?? ''}
        error={errors.remark}
      />
    </FormDialog>
  );
}
