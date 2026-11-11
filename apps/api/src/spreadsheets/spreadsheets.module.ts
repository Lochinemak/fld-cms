import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module.js';
import { multerOptions } from '../files/upload.js';
import { SpreadsheetRegistry } from './spreadsheet-registry.js';
import { SpreadsheetsController } from './spreadsheets.controller.js';
import { SpreadsheetsProcessor } from './spreadsheets.processor.js';
import { SPREADSHEETS_QUEUE, SpreadsheetsService } from './spreadsheets.service.js';

/**
 * Exports and imports of spreadsheets. Models plug in through SpreadsheetRegistry, which every
 * module can reach.
 */
@Global()
@Module({
  imports: [
    AuthModule,
    MulterModule.registerAsync({ inject: [ConfigService], useFactory: multerOptions }),
    BullModule.registerQueue({ name: SPREADSHEETS_QUEUE }),
  ],
  controllers: [SpreadsheetsController],
  providers: [SpreadsheetRegistry, SpreadsheetsService, SpreadsheetsProcessor],
  exports: [SpreadsheetRegistry],
})
export class SpreadsheetsModule {}
