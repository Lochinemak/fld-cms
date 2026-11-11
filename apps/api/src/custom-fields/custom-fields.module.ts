import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { DictionariesController } from './dictionaries.controller.js';
import { DictionariesService } from './dictionaries.service.js';

/** Data dictionaries and the custom fields tenants add to their models. */
@Module({
  controllers: [DictionariesController, CustomFieldsController],
  providers: [DictionariesService, CustomFieldsService],
  exports: [DictionariesService, CustomFieldsService],
})
export class CustomFieldsModule {}
