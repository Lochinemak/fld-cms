import { Global, Module } from '@nestjs/common';
import { SnowflakeService } from './snowflake.service.js';

@Global()
@Module({
  providers: [SnowflakeService],
  exports: [SnowflakeService],
})
export class SnowflakeModule {}
