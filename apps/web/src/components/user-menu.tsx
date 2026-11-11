import { useQueryClient } from '@tanstack/react-query';
import { CircleUser, KeyRound, LogOut, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { ChangePasswordDialog } from '@/components/change-password-form';
import { ProfileDialog } from '@/components/profile-dialog';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { meQuery, signOutAndReload, useMe } from '@/lib/auth';

export function UserMenu() {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const [editingProfile, setEditingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  function editProfile() {
    // Asked again: the email changes in another tab, the one the mailed link opens.
    void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    setEditingProfile(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <CircleUser />
          <span className="max-w-40 truncate">{user.displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
              <div className="truncate text-xs font-normal">{user.username}</div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={editProfile}>
            <UserRoundPen />
            个人资料
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChangingPassword(true)}>
            <KeyRound />
            修改密码
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void signOutAndReload()}>
            <LogOut />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editingProfile && <ProfileDialog onClosed={() => setEditingProfile(false)} />}
      {changingPassword && <ChangePasswordDialog onClosed={() => setChangingPassword(false)} />}
    </>
  );
}
