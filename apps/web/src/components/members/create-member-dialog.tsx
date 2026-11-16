import { createMemberSchema } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  AccountChoiceFields,
  readAccountChoice,
  type AccountMode,
} from '@/components/account-choice-fields';
import { FormDialog } from '@/components/form-dialog';
import { DeptField, RoleChecklist } from '@/components/members/member-fields';
import type { OneTimePassword } from '@/components/one-time-password-dialog';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import type { DeptNode } from '@/lib/dept-tree';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import { createMember, refreshSystem } from '@/lib/system';

interface CreateMemberDialogProps {
  nodes: readonly DeptNode[];
  defaultDeptId: string | null;
  /** A new account's generated password, to show once. */
  onCreated: (secret: OneTimePassword) => void;
  onClosed: () => void;
}

/** Adds a member: an existing account, or a new one made on the spot. */
export function CreateMemberDialog({
  nodes,
  defaultDeptId,
  onCreated,
  onClosed,
}: CreateMemberDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [mode, setMode] = useState<AccountMode>('existing');
  const [deptId, setDeptId] = useState(defaultDeptId);
  const [roleIds, setRoleIds] = useState(() => new Set<string>());
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: createMember,
    onSuccess: async ({ member, initialPassword }) => {
      await refreshSystem(queryClient);
      if (initialPassword) {
        onCreated({
          title: `已添加成员「${member.displayName}」`,
          username: member.username,
          password: initialPassword,
        });
      }
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createMemberSchema.safeParse({
      account: readAccountChoice(form, 'account', mode),
      deptId,
      roleIds: [...roleIds],
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title="添加成员"
      description="把已有账号加入本租户，或者为新同事创建账号。"
      error={mutation.error}
      pending={mutation.isPending}
      submitLabel="添加"
      pendingLabel="添加中…"
      onSubmit={handleSubmit}
      className="sm:max-w-lg"
      formClassName="flex max-h-[calc(100svh-4rem)] flex-col gap-4"
    >
      <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
        <AccountChoiceFields
          name="account"
          mode={mode}
          onModeChange={(next) => {
            setMode(next);
            setErrors({});
            mutation.reset();
          }}
          errors={errors}
        />
        <DeptField nodes={nodes} value={deptId} onChange={setDeptId} error={errors['deptId']} />
        <RoleChecklist value={roleIds} onChange={setRoleIds} error={errors['roleIds']} />
      </div>
    </FormDialog>
  );
}
