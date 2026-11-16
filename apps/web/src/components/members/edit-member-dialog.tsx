import {
  updateMemberSchema,
  type Member,
  type MemberStatus,
  type UpdateMemberInput,
} from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { DeptField, RoleChecklist } from '@/components/members/member-fields';
import { StatusField } from '@/components/status-field';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import type { DeptNode } from '@/lib/dept-tree';
import { fieldErrors, type FieldErrors } from '@/lib/form';
import { refreshSystem, updateMember } from '@/lib/system';

interface EditMemberDialogProps {
  member: Member;
  nodes: readonly DeptNode[];
  onClosed: () => void;
}

/** Changes a member's department, roles and status in this tenant. */
export function EditMemberDialog({ member, nodes, onClosed }: EditMemberDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [deptId, setDeptId] = useState(member.dept?.id ?? null);
  const [roleIds, setRoleIds] = useState(() => new Set(member.roles.map(({ id }) => id)));
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: (input: UpdateMemberInput) => updateMember(member.id, input),
    onSuccess: async () => {
      await refreshSystem(queryClient);
      dialog.close();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Only what changed: the API checks each change against the editor's own rights.
    const sameRoles =
      roleIds.size === member.roles.length && member.roles.every(({ id }) => roleIds.has(id));
    const changes = {
      ...(deptId === (member.dept?.id ?? null) ? {} : { deptId }),
      ...(sameRoles ? {} : { roleIds: [...roleIds] }),
      ...(status === member.status ? {} : { status }),
    };
    if (Object.keys(changes).length === 0) {
      dialog.close();
      return;
    }
    const parsed = updateMemberSchema.safeParse(changes);
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
    if (parsed.success) {
      mutation.mutate(parsed.data);
    }
  }

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={<>编辑成员「{member.displayName}」</>}
      description="用户名、姓名和邮箱由账号本人维护；这里只调整它在本租户的部门、角色和状态。"
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={handleSubmit}
      className="sm:max-w-lg"
      formClassName="flex max-h-[calc(100svh-4rem)] flex-col gap-4"
    >
      <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
        <DeptField nodes={nodes} value={deptId} onChange={setDeptId} error={errors['deptId']} />
        <RoleChecklist value={roleIds} onChange={setRoleIds} error={errors['roleIds']} />
        <StatusField
          value={status}
          onChange={setStatus}
          hint="停用后，对方不能再进入这个租户；它在其他租户的使用不受影响。"
        />
      </div>
    </FormDialog>
  );
}
