import { z } from 'zod';
import { idSchema } from './id.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

export const notificationSchema = z.object({
  id: idSchema,
  /** What it is about: export, import, transfer. */
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** A page of the web app to open. */
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPageSchema = pageSchema(notificationSchema).extend({
  unread: z.number().int(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const notificationQuerySchema = pageQuerySchema.omit({ keyword: true }).extend({
  unreadOnly: z.stringbool().optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const unreadCountSchema = z.object({ unread: z.number().int() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;
