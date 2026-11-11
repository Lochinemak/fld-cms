import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATIONS_QUEUE, NotificationsProcessor } from './notifications.processor.js';
import { NotificationsService } from './notifications.service.js';

/** Notifications: NotificationsService.notify() is open to every module. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
