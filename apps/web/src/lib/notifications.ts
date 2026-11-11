import { notificationPageSchema, unreadCountSchema } from '@fld/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { currentLocale } from '@/i18n';

/** How many the bell's menu lists. */
export const LATEST_NOTIFICATIONS = 10;

export const unreadCountQuery = queryOptions({
  queryKey: ['notifications', 'unread-count'],
  queryFn: () => api('/notifications/unread-count', { schema: unreadCountSchema }),
  refetchInterval: 60_000,
  refetchOnWindowFocus: 'always',
});

export const latestNotificationsQuery = queryOptions({
  queryKey: ['notifications', 'latest'],
  queryFn: () =>
    api(`/notifications?page=1&pageSize=${LATEST_NOTIFICATIONS}`, {
      schema: notificationPageSchema,
    }),
  // Asked again each time the menu opens.
  staleTime: 0,
});

export const markNotificationRead = (id: string) =>
  api(`/notifications/${id}/read`, { method: 'POST' });

export const markAllNotificationsRead = () => api('/notifications/read-all', { method: 'POST' });

export const refreshNotifications = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: ['notifications'] });

/** How long ago, roughly: 刚刚, 5 分钟前, 3 小时前, then the date. */
export function formatNotificationTime(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)} 小时前`;
  }
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: 'short', timeStyle: 'short' });
}
