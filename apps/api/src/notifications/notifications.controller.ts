import {
  idSchema,
  notificationQuerySchema,
  type NotificationPage,
  type NotificationQuery,
  type UnreadCount,
} from '@fld/shared';
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { NotificationsService } from './notifications.service.js';

/** The signed-in member's own notifications in the current tenant. */
@ApiTags('notifications')
@Can.Anyone()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: notificationQuerySchema }) query: NotificationQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(user, query);
  }

  /** Polled by the bell. */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: Principal): Promise<UnreadCount> {
    return { unread: await this.notifications.unread(user) };
  }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: Principal): Promise<void> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(204)
  markRead(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.notifications.markRead(user, id);
  }
}
