import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { MailTransport, SmtpMailTransport } from './mail.transport.js';
import { PlatformSettingsService } from './platform-settings.service.js';
import { SettingsController } from './settings.controller.js';

@Module({
  controllers: [SettingsController],
  providers: [
    PlatformSettingsService,
    MailService,
    { provide: MailTransport, useClass: SmtpMailTransport },
  ],
  exports: [PlatformSettingsService, MailService],
})
export class SettingsModule {}
