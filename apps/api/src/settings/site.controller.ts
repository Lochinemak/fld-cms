import type { Site } from '@fld/shared';
import { Public } from '@nestjs/authentication';
import { Controller, Get } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { PlatformSettingsService } from './platform-settings.service.js';

/** What every page shows of the site. Anyone may read it: the sign-in page asks before a sign-in. */
@ApiTags('site')
@Controller('site')
export class SiteController {
  constructor(private readonly settings: PlatformSettingsService) {}

  /**
   * `tenant` names the tenant the browser works in, for what tenants come to set for themselves.
   * So far they set nothing, so any tenant gets what the platform settings say, and so does a
   * tenant that does not exist: the answer tells nobody which tenants there are.
   */
  @Public()
  @ApiQuery({
    name: 'tenant',
    required: false,
    description: 'ID of the tenant the browser works in. Nothing depends on it yet.',
  })
  @Get()
  async site(): Promise<Site> {
    return { name: await this.settings.appName() };
  }
}
