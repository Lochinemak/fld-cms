import {
  mailTemplateKeySchema,
  testMailSchema,
  updateMailTemplateSchema,
  updatePlatformSettingsSchema,
  type MailTemplate,
  type MailTemplateKey,
  type PlatformSettingsView,
  type TestMailInput,
  type UpdateMailTemplateInput,
  type UpdatePlatformSettingsInput,
} from '@fld/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AuditService, changesOf, type AuditEvent } from '../audit/audit.service.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { MailService } from './mail.service.js';
import { PlatformSettingsService } from './platform-settings.service.js';

/** Mail and site settings, which only the system tenant's permissions grant. */
@ApiTags('system')
@Controller('system')
export class SettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('system:settings')
  @Get('settings')
  view(): Promise<PlatformSettingsView> {
    return this.settings.view();
  }

  @RequirePermission('system:settings:update')
  @Put('settings')
  update(
    @Body({ schema: updatePlatformSettingsSchema }) input: UpdatePlatformSettingsInput,
  ): Promise<PlatformSettingsView> {
    return this.settings.update(input);
  }

  /** Sends a test message with the saved settings. */
  @RequirePermission('system:settings:update')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  @Post('settings/test-mail')
  @HttpCode(HttpStatus.NO_CONTENT)
  async testMail(@Body({ schema: testMailSchema }) input: TestMailInput): Promise<void> {
    const event: AuditEvent = {
      action: 'settings.test-mail',
      target: { type: 'settings', name: '邮件和网站' },
      changes: changesOf([['收件人', null, input.to]]),
    };
    try {
      await this.mail.sendTest(input.to);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.audit.record({ ...event, success: false, reason });
      throw error;
    }
    await this.audit.record(event);
  }

  @RequirePermission('system:settings')
  @Get('mail-templates')
  mailTemplates(): Promise<MailTemplate[]> {
    return this.settings.mailTemplates();
  }

  @RequirePermission('system:settings:update')
  @Put('mail-templates/:key')
  updateMailTemplate(
    @Param('key', { schema: mailTemplateKeySchema }) key: MailTemplateKey,
    @Body({ schema: updateMailTemplateSchema }) input: UpdateMailTemplateInput,
  ): Promise<MailTemplate> {
    return this.settings.updateMailTemplate(key, input);
  }

  /** Restores the built-in template. */
  @RequirePermission('system:settings:update')
  @Delete('mail-templates/:key')
  resetMailTemplate(
    @Param('key', { schema: mailTemplateKeySchema }) key: MailTemplateKey,
  ): Promise<MailTemplate> {
    return this.settings.resetMailTemplate(key);
  }
}
