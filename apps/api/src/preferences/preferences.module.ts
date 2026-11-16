import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller.js';
import { PreferencesService } from './preferences.service.js';

/** Each member's own preferences, such as the columns of a table. */
@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class PreferencesModule {}
