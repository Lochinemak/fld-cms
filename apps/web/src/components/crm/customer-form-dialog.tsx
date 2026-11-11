import {
  createCustomerSchema,
  customerLevelSchema,
  customerSourceSchema,
  customerStatusSchema,
  updateCustomerSchema,
  type Customer,
  type CustomerLevel,
  type CustomerSource,
  type CustomerStatus,
} from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { SelectField } from '@/components/select-field';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import {
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_SOURCE_LABELS,
  CUSTOMER_STATUS_LABELS,
  createCustomer,
  refreshCrm,
  updateCustomer,
} from '@/lib/crm';
import { parseForm, type FieldErrors } from '@/lib/form';

const LEVELS = customerLevelSchema.options.map((value) => ({
  value,
  label: CUSTOMER_LEVEL_LABELS[value],
}));
const STATUSES = customerStatusSchema.options.map((value) => ({
  value,
  label: CUSTOMER_STATUS_LABELS[value],
}));
const SOURCES = customerSourceSchema.options.map((value) => ({
  value,
  label: CUSTOMER_SOURCE_LABELS[value],
}));

interface CustomerFormDialogProps {
  /** The customer to edit; without one, the dialog creates a customer. */
  customer?: Customer;
  onClosed: () => void;
}

export function CustomerFormDialog({ customer, onClosed }: CustomerFormDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [level, setLevel] = useState<CustomerLevel>(customer?.level ?? 'B');
  const [status, setStatus] = useState<CustomerStatus>(customer?.status ?? 'POTENTIAL');
  const [source, setSource] = useState<CustomerSource | null>(customer?.source ?? null);
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
      level,
      status,
      source,
      industry: form.get('industry'),
      phone: form.get('phone'),
      address: form.get('address'),
      remark: form.get('remark'),
    };
    if (customer) {
      const input = parseForm(updateCustomerSchema, values, setErrors);
      if (input) {
        mutation.mutate(() => updateCustomer(customer.id, input));
      }
    } else {
      const input = parseForm(createCustomerSchema, values, setErrors);
      if (input) {
        mutation.mutate(() => createCustomer(input));
      }
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={customer ? '编辑客户' : '新建客户'}
      description={
        customer ? `修改「${customer.name}」的资料。` : '新客户由你负责，归入你所在的部门。'
      }
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={submit}
      className="sm:max-w-lg"
    >
      <TextField
        name="name"
        label="客户名称"
        defaultValue={customer?.name}
        error={errors.name}
        autoFocus
        required
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          id="customer-level"
          label="级别"
          options={LEVELS}
          value={level}
          onValueChange={(next) => next && setLevel(next)}
          error={errors.level}
        />
        <SelectField
          id="customer-status"
          label="状态"
          options={STATUSES}
          value={status}
          onValueChange={(next) => next && setStatus(next)}
          error={errors.status}
        />
        <SelectField
          id="customer-source"
          label="来源"
          options={SOURCES}
          value={source}
          onValueChange={setSource}
          emptyLabel="未填写"
          error={errors.source}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="industry"
          label="行业"
          defaultValue={customer?.industry ?? ''}
          error={errors.industry}
        />
        <TextField
          name="phone"
          label="电话"
          type="tel"
          defaultValue={customer?.phone ?? ''}
          error={errors.phone}
        />
      </div>
      <TextField
        name="address"
        label="地址"
        defaultValue={customer?.address ?? ''}
        error={errors.address}
      />
      <TextareaField
        name="remark"
        label="备注"
        rows={3}
        defaultValue={customer?.remark ?? ''}
        error={errors.remark}
      />
    </FormDialog>
  );
}
