import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { OnModuleDestroy } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  type ByteRange,
  checkKey,
  type PutOptions,
  type SignedUrlOptions,
  Storage,
  StorageObjectNotFoundError,
} from './storage.js';

export interface S3StorageOptions {
  bucket: string;
  /** Unset for AWS itself. */
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  /** Unset, the AWS SDK looks for credentials itself. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Off when browsers can't reach the endpoint, so downloads go through the API. */
  signedDownloads: boolean;
}

/** Keeps objects in one bucket on an S3-compatible server. */
export class S3Storage extends Storage implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly options: S3StorageOptions) {
    super();
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: options.credentials,
      // Several S3-compatible servers reject the checksum headers the SDK adds by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, path: string, { size, contentType }: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: checkKey(key),
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    try {
      const { Body } = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: checkKey(key),
          Range: range && `bytes=${range.start}-${range.end}`,
        }),
      );
      return Body as Readable;
    } catch (error) {
      throw isNotFound(error) ? new StorageObjectNotFoundError(key) : error;
    }
  }

  async copy(from: string, to: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: checkKey(to),
          // Keys need no URL encoding: checkKey only lets through characters that are safe in URLs.
          CopySource: `${this.bucket}/${checkKey(from)}`,
        }),
      );
    } catch (error) {
      throw isNotFound(error) ? new StorageObjectNotFoundError(from) : error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string | undefined> {
    if (!this.options.signedDownloads) return undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: checkKey(key),
      ResponseContentType: options.contentType,
      ResponseContentDisposition: options.contentDisposition,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresIn });
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.name === 'NoSuchKey';
}
