import { createFollowUpSchema, followUpMethodSchema, type FollowUpMethod } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { SelectField } from '@/components/select-field';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan } from '@/lib/auth';
import {
  FOLLOW_UP_METHOD_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  contactsQuery,
  createFollowUp,
  fromLocalInput,
  opportunitiesQuery,
  refreshCrm,
  toLocalInput,
} from '@/lib/crm';
import { parseForm, type FieldErrors } from '@/lib/form';

const METHODS = followUpMethodSchema.options.map((value) => ({
  value,
  label: FOLLOW_UP_METHOD_LABELS[value],
}));

interface FollowUpFormDialogProps {
  /** The customer followed up. */
  customerId: string;
  onClosed: () => void;
}

export function FollowUpFormDialog({ customerId, onClosed }: FollowUpFormDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const canSeeContacts = useCan('crm:contact');
  const canSeeOpportunities = useCan('crm:opportunity');
  const contacts = useQuery({ ...contactsQuery({ page: 1, customerId }), enabled: canSeeContacts });
  const opportunities = useQuery({
    ...opportunitiesQuery({ page: 1, customerId }),
    enabled: canSeeOpportunities,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [method, setMethod] = useState<FollowUpMethod>('CALL');
  const [contactId, setContactId] = useState<string | null>(null);
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [now] = useState(() => toLocalInput(new Date()));
  const mutation = useMutation({
    mutationFn: createFollowUp,
    onSuccess: async () => {
      await refreshCrm(queryClient);
      dialog.close();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = parseForm(
      createFollowUpSchema,
      {
        customerId,
        contactId: contactId ?? undefined,
        opportunityId: opportunityId ?? undefined,
        method,
        content: form.get('content'),
        followedAt: fromLocalInput(form.get('followedAt')),
        nextAt: fromLocalInput(form.get('nextAt')),
      },
      setErrors,
    );
    if (input) {
      mutation.mutate(input);
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title="写跟进"
      description="记下这次跟进；客户的最近跟进和下次跟进时间会随之更新。跟进记录写下后不能修改。"
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={submit}
      className="sm:max-w-lg"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="follow-up-method"
          label="方式"
          options={METHODS}
          value={method}
          onValueChange={(next) => next && setMethod(next)}
          error={errors.method}
        />
        <TextField
          name="followedAt"
          label="跟进时间"
          type="datetime-local"
          defaultValue={now}
          max={now}
          error={errors.followedAt}
        />
        {canSeeContacts && (
          <SelectField
            id="follow-up-contact"
            label="联系人"
            options={(contacts.data?.items ?? []).map((contact) => ({
              value: contact.id,
              label: contact.title ? `${contact.name}（${contact.title}）` : contact.name,
            }))}
            value={contactId}
            onValueChange={setContactId}
            emptyLabel="不指定"
            error={errors.contactId}
          />
        )}
        {canSeeOpportunities && (
          <SelectField
            id="follow-up-opportunity"
            label="关联商机"
            options={(opportunities.data?.items ?? []).map((opportunity) => ({
              value: opportunity.id,
              label: `${opportunity.name}（${OPPORTUNITY_STAGE_LABELS[opportunity.stage]}）`,
            }))}
            value={opportunityId}
            onValueChange={setOpportunityId}
            emptyLabel="不关联"
            error={errors.opportunityId}
          />
        )}
      </div>
      <TextareaField
        name="content"
        label="跟进内容"
        rows={4}
        error={errors.content}
        autoFocus
        required
      />
      <TextField
        name="nextAt"
        label="下次跟进"
        type="datetime-local"
        min={now}
        error={errors.nextAt}
        hint="可不填；填了，到期当天客户会出现在「今天要跟进」里。"
      />
    </FormDialog>
  );
}
