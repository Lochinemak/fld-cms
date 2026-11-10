import { useNavigate } from '@tanstack/react-router';
import { CircleUser, KeyRound, LogOut } from 'lucide-react';
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
  const navigate = useNavigate();

  return (
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
        <DropdownMenuItem onClick={() => void navigate({ to: '/change-password' })}>
          <KeyRound />
          修改密码
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOutAndReload()}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
