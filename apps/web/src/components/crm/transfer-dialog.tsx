import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { SelectField } from '@/components/select-field';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { ownersQuery, refreshCrm } from '@/lib/crm';

interface TransferDialogProps {
  /** What changes hands, as the title names it, such as 客户「华东电子」. */
  subject: string;
  /** The current owner, who isn't offered. */
  ownerId: string;
  transfer: (ownerId: string) => Promise<unknown>;
  onClosed: () => void;
}

/** Hands a customer or an opportunity to another member. */
export function TransferDialog({ subject, ownerId, transfer, onClosed }: TransferDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const owners = useQuery(ownersQuery);
  const [newOwnerId, setNewOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const mutation = useMutation({
    mutationFn: transfer,
    onSuccess: async () => {
      await refreshCrm(queryClient);
      dialog.close();
    },
  });
  const options = (owners.data ?? [])
    .filter((owner) => owner.id !== ownerId)
    .map((owner) => ({
      value: owner.id,
      label: owner.dept ? `${owner.displayName}（${owner.dept.name}）` : owner.displayName,
    }));
  const failure = mutation.error ?? owners.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newOwnerId === null) {
      setError('请选择新负责人');
      return;
    }
    setError(undefined);
    mutation.mutate(newOwnerId);
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={<>转移{subject}</>}
      description="只能转给你数据范围内已启用的成员；转移后，记录归入新负责人所在的部门。"
      error={failure}
      pending={mutation.isPending}
      submitLabel="转移"
      pendingLabel="转移中…"
      onSubmit={submit}
    >
      <SelectField
        id="transfer-owner"
        label="新负责人"
        options={options}
        value={newOwnerId}
        onValueChange={setNewOwnerId}
        placeholder={
          owners.isPending ? '加载中…' : options.length > 0 ? '选择成员' : '没有可选的成员'
        }
        error={error}
      />
    </FormDialog>
  );
}
