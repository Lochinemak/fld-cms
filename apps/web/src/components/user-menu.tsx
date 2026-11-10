import { CircleUser, KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { ChangePasswordDialog } from '@/components/change-password-form';
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
import { signOutAndReload, useMe } from '@/lib/auth';

export function UserMenu() {
  const { user } = useMe();
  const [changingPassword, setChangingPassword] = useState(false);

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
      {changingPassword && <ChangePasswordDialog onClosed={() => setChangingPassword(false)} />}
    </>
  );
}
