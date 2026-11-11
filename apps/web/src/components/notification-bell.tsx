import type { Notification } from '@fld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  formatNotificationTime,
  latestNotificationsQuery,
  markAllNotificationsRead,
  markNotificationRead,
  refreshNotifications,
  unreadCountQuery,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

/** The bell in the top bar: how many notifications are unread, and the latest ones. */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = useQuery(unreadCountQuery).data?.unread ?? 0;
  const latest = useQuery({ ...latestNotificationsQuery, enabled: open });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: () => refreshNotifications(queryClient),
  });

  function openNotification(notification: Notification) {
    if (!notification.read) {
      void markNotificationRead(notification.id).finally(
        () => void refreshNotifications(queryClient),
      );
    }
    if (notification.link?.startsWith('/')) {
      void router.navigate({ href: notification.link });
    }
  }

  const items = latest.data?.items ?? [];
  const label = unread > 0 ? `通知，${unread} 条未读` : '通知';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative')}
        aria-label={label}
        title="通知"
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-medium text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
          <span className="text-sm font-medium">通知</span>
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            全部标为已读
          </button>
        </div>
        <DropdownMenuSeparator />
        {latest.isPending ? (
          <p className="px-1.5 py-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : latest.error ? (
          <p className="px-1.5 py-6 text-center text-sm text-destructive">{latest.error.message}</p>
        ) : items.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-sm text-muted-foreground">暂无通知</p>
        ) : (
          items.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="items-start gap-2 py-2"
              onClick={() => openNotification(notification)}
            >
              <span
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  notification.read ? 'bg-transparent' : 'bg-primary',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      notification.read ? 'text-muted-foreground' : 'font-medium',
                    )}
                  >
                    {notification.read ? '' : <span className="sr-only">未读：</span>}
                    {notification.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </div>
                {notification.body && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
