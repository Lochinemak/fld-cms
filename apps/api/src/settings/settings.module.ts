import { Module } from '@nestjs/common';
import { LogtoSettingsService } from './logto-settings.service.js';
import { MailService } from './mail.service.js';
import { MailTransport, SmtpMailTransport } from './mail.transport.js';
import { PlatformSettingsService } from './platform-settings.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsStore } from './settings.store.js';

@Module({
  controllers: [SettingsController],
  providers: [
    SettingsStore,
    PlatformSettingsService,
    LogtoSettingsService,
    MailService,
    { provide: MailTransport, useClass: SmtpMailTransport },
  ],
  exports: [PlatformSettingsService, LogtoSettingsService, MailService],
})
export class SettingsModule {}
