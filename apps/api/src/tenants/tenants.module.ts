import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemBootstrapService } from './system-bootstrap.service.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [SystemBootstrapService, TenantsService],
})
export class TenantsModule {}
