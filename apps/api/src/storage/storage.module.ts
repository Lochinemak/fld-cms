import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { LocalStorage } from './local-storage.js';
import { S3Storage } from './s3-storage.js';
import { Storage } from './storage.js';

function createStorage(config: ConfigService<Env, true>): Storage {
  if (config.get('STORAGE_DRIVER', { infer: true }) === 'local') {
    return new LocalStorage(config.get('STORAGE_LOCAL_DIR', { infer: true }));
  }
  const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
  return new S3Storage({
    bucket: config.getOrThrow('S3_BUCKET', { infer: true }),
    endpoint: config.get('S3_ENDPOINT', { infer: true }),
    region: config.get('S3_REGION', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    signedDownloads: config.get('S3_SIGNED_DOWNLOADS', { infer: true }),
  });
}

/** Provides the Storage that STORAGE_DRIVER picks. */
@Global()
@Module({
  providers: [{ provide: Storage, inject: [ConfigService], useFactory: createStorage }],
  exports: [Storage],
})
export class StorageModule {}
