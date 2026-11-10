import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { FollowUpsController } from './follow-ups.controller.js';
import { FollowUpsService } from './follow-ups.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';
import { OwnersController } from './owners.controller.js';
import { OwnersService } from './owners.service.js';

@Module({
  controllers: [
    CustomersController,
    ContactsController,
    FollowUpsController,
    OpportunitiesController,
    OwnersController,
  ],
  providers: [
    CustomersService,
    ContactsService,
    FollowUpsService,
    OpportunitiesService,
    OwnersService,
  ],
})
export class CrmModule {}
