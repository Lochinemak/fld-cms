import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import type { Env } from '../config/env.js';

/** What multer leaves of an upload: a temporary file, which the handler removes. */
export interface UploadedTempFile {
  path: string;
  originalname: string;
  size: number;
}

export function multerOptions(config: ConfigService<Env, true>): MulterModuleOptions {
  return {
    dest: join(tmpdir(), 'fld-uploads'),
    limits: {
      fileSize: config.get('FILE_MAX_SIZE_MB', { infer: true }) * 1024 * 1024,
      files: 1,
      fields: 5,
    },
    // Browsers send the file name as raw UTF-8, which busboy reads as Latin-1 by default.
    defParamCharset: 'utf8',
  };
}

/**
 * Puts multer's errors into words for users, and removes the upload of a request that fails
 * before its handler could, as when the query is invalid. Goes before FileInterceptor.
 */
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<Env, true>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: UploadedTempFile }>();
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(removeUpload(request.file)).pipe(
            mergeMap(() => throwError(() => this.reword(error))),
          ),
        ),
      );
  }

  private reword(error: unknown): unknown {
    if (error instanceof PayloadTooLargeException) {
      const limit = this.config.get('FILE_MAX_SIZE_MB', { infer: true });
      return new PayloadTooLargeException(`文件不能超过 ${limit} MB`);
    }
    if (
      error instanceof HttpException &&
      (error.cause as Error | undefined)?.name === 'MulterError'
    ) {
      return new BadRequestException('上传的内容不正确，请重新选择文件');
    }
    return error;
  }
}

export async function removeUpload(file: UploadedTempFile | undefined): Promise<void> {
  if (file) {
    await rm(file.path, { force: true });
  }
}
