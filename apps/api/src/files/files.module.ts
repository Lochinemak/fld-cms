import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { FilePurgeService } from './file-purge.service.js';
import { FileRefsService } from './file-refs.service.js';
import { FileSharesController } from './file-shares.controller.js';
import { FileSharesService } from './file-shares.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { FoldersController } from './folders.controller.js';
import { FoldersService } from './folders.service.js';
import { PublicSharesController } from './public-shares.controller.js';
import { PublicSharesService } from './public-shares.service.js';
import { multerOptions } from './upload.js';

@Module({
  imports: [MulterModule.registerAsync({ inject: [ConfigService], useFactory: multerOptions })],
  // FilesController last: Express tries routes in the order they are registered, and its files/:id
  // would otherwise take files/folders.
  controllers: [FoldersController, FileSharesController, PublicSharesController, FilesController],
  providers: [
    FoldersService,
    FilesService,
    FileSharesService,
    PublicSharesService,
    FileRefsService,
    FilePurgeService,
  ],
  exports: [FileRefsService],
})
export class FilesModule {}
