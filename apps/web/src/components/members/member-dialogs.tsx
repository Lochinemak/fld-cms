import type { Member } from '@fld/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CreateMemberDialog } from '@/components/members/create-member-dialog';
import { EditMemberDialog } from '@/components/members/edit-member-dialog';
import { OneTimePasswordDialog, type OneTimePassword } from '@/components/one-time-password-dialog';
import type { DeptNode } from '@/lib/dept-tree';
import {
  refreshSystem,
  removeMember,
  resetMemberMfa,
  resetMemberPassword,
  unlockMember,
} from '@/lib/system';

export type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; member: Member }
  | { kind: 'reset'; member: Member }
  | { kind: 'unlock'; member: Member }
  | { kind: 'reset-mfa'; member: Member }
  | { kind: 'remove'; member: Member };

interface MemberDialogsProps {
  /** The dialog that is open, if any. */
  dialog: DialogState | null;
  nodes: readonly DeptNode[];
  /** The department a new member starts in. */
  defaultDeptId: string | null;
  onClosed: () => void;
}

/** The dialog for the action picked on the members page, and the password it may end with. */
export function MemberDialogs({ dialog, nodes, defaultDeptId, onClosed }: MemberDialogsProps) {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<OneTimePassword | null>(null);

  return (
    <>
      {dialog?.kind === 'create' && (
        <CreateMemberDialog
          nodes={nodes}
          defaultDeptId={defaultDeptId}
          onCreated={setSecret}
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditMemberDialog member={dialog.member} nodes={nodes} onClosed={onClosed} />
      )}
      {dialog?.kind === 'reset' && (
        <ConfirmDialog
          title={`重置「${dialog.member.displayName}」的密码？`}
          description="会生成一个新密码，并让这个账号在所有设备上退出登录。对方用新密码登录后必须先修改密码。"
          confirmLabel="重置密码"
          action={async () => {
            const { password } = await resetMemberPassword(dialog.member.id);
            setSecret({ title: '密码已重置', username: dialog.member.username, password });
            await refreshSystem(queryClient);
          }}
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'unlock' && (
        <ConfirmDialog
          title={`解锁「${dialog.member.displayName}」的账号？`}
          description={`连续输错密码太多次，这个账号已被锁定。解锁后本人就能用原来的密码登录${
            dialog.member.sharedAccount ? '，在它所属的其他租户也一样' : ''
          }。`}
          confirmLabel="解锁"
          action={async () => {
            await unlockMember(dialog.member.id);
            await refreshSystem(queryClient);
          }}
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'reset-mfa' && (
        <ConfirmDialog
          title={`关闭「${dialog.member.displayName}」的两步验证？`}
          description={`对方手机和恢复码都丢了时用。关闭后只用密码就能登录${
            dialog.member.sharedAccount ? '，在它所属的其他租户也一样' : ''
          }；本人可以再重新开启。请先确认是本人在找你。`}
          confirmLabel="关闭两步验证"
          destructive
          action={async () => {
            await resetMemberMfa(dialog.member.id);
            await refreshSystem(queryClient);
          }}
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={`将「${dialog.member.displayName}」移出本租户？`}
          description="账号本身不会删除，只是不能再进入这个租户；之后可以再把它添加回来。"
          confirmLabel="移出"
          destructive
          action={async () => {
            await removeMember(dialog.member.id);
            await refreshSystem(queryClient);
          }}
          onClosed={onClosed}
        />
      )}
      {secret && <OneTimePasswordDialog secret={secret} onClosed={() => setSecret(null)} />}
    </>
  );
}
