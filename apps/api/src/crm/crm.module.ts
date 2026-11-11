import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module.js';
import { FilesModule } from '../files/files.module.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { CrmSpreadsheets } from './crm-spreadsheets.js';
import { CustomerAttachmentsController } from './customer-attachments.controller.js';
import { CustomerAttachmentsService } from './customer-attachments.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { FollowUpsController } from './follow-ups.controller.js';
import { FollowUpsService } from './follow-ups.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';
import { OwnersController } from './owners.controller.js';
import { OwnersService } from './owners.service.js';

@Module({
  imports: [FilesModule, CustomFieldsModule],
  controllers: [
    CustomersController,
    CustomerAttachmentsController,
    ContactsController,
    FollowUpsController,
    OpportunitiesController,
    OwnersController,
  ],
  providers: [
    CustomersService,
    CustomerAttachmentsService,
    ContactsService,
    FollowUpsService,
    OpportunitiesService,
    OwnersService,
    CrmSpreadsheets,
  ],
})
export class CrmModule {}
