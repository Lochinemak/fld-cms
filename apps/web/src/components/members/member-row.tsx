import type { Member } from '@fld/shared';
import { Ellipsis, KeyRound, LockOpen, Pencil, ShieldOff, UserMinus } from 'lucide-react';
import type { DialogState } from '@/components/members/member-dialogs';
import { StatusBadge } from '@/components/status-field';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import { formatDate } from '@/lib/system';

interface MemberRowProps {
  member: Member;
  /** The signed-in user's own membership, which they can't change here. */
  self: boolean;
  onAction: (state: DialogState) => void;
}

/** A member in the list, with the actions the user may take on them. */
export function MemberRow({ member, self, onAction }: MemberRowProps) {
  const canUpdate = useCan('system:member:update');
  const canReset = useCan('system:member:reset-password');
  const canUnlock = useCan('system:member:unlock') && member.locked;
  const canResetMfa = useCan('system:member:reset-mfa') && member.mfaEnabled;
  const canRemove = useCan('system:member:remove');

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2 font-medium">
          {member.displayName}
          {self && <Badge variant="outline">我</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {member.username}
          {member.email && ` · ${member.email}`}
        </div>
      </TableCell>
      <TableCell>{member.dept?.name ?? '—'}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {member.roles.length === 0 && <span className="text-muted-foreground">—</span>}
          {member.roles.map((role) => (
            <Badge key={role.id} variant={role.builtin ? 'default' : 'secondary'}>
              {role.name}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={member.status} />
          {member.locked && <Badge variant="destructive">已锁定</Badge>}
          {member.mfaEnabled && <Badge variant="outline">两步验证</Badge>}
        </div>
      </TableCell>
      <TableCell>{formatDate(member.joinedAt)}</TableCell>
      <TableCell>
        {!self && (canUpdate || canReset || canUnlock || canResetMfa || canRemove) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={`操作：${member.displayName}`}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {canUpdate && (
                <DropdownMenuItem onClick={() => onAction({ kind: 'edit', member })}>
                  <Pencil />
                  编辑
                </DropdownMenuItem>
              )}
              {canUnlock && (
                <DropdownMenuItem onClick={() => onAction({ kind: 'unlock', member })}>
                  <LockOpen />
                  解锁
                </DropdownMenuItem>
              )}
              {canResetMfa && (
                <DropdownMenuItem onClick={() => onAction({ kind: 'reset-mfa', member })}>
                  <ShieldOff />
                  重置两步验证
                </DropdownMenuItem>
              )}
              {canReset && (
                <DropdownMenuItem
                  disabled={member.sharedAccount}
                  onClick={() => onAction({ kind: 'reset', member })}
                >
                  <KeyRound />
                  重置密码
                </DropdownMenuItem>
              )}
              {canReset && member.sharedAccount && (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                  该账号还属于其他租户：可由本人用「忘记密码」重设，或请平台管理员重置。
                </p>
              )}
              {canRemove && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onAction({ kind: 'remove', member })}
                >
                  <UserMinus />
                  移出租户
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}
