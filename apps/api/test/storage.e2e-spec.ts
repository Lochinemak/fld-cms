import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { envSchema } from '../src/config/env.js';
import { LocalStorage } from '../src/storage/local-storage.js';
import { S3Storage, type S3StorageOptions } from '../src/storage/s3-storage.js';
import { type Storage, StorageObjectNotFoundError } from '../src/storage/storage.js';
import { TEST_BUCKET } from './test-env.js';

const CONTENT = '0123456789abcdef';
const PUT = { size: CONTENT.length, contentType: 'text/plain' };
const DISPOSITION = "attachment; filename*=UTF-8''%E5%90%88%E5%90%8C.txt";

const env = envSchema.parse(process.env);
if (process.env['CI'] && !env.S3_ENDPOINT) {
  throw new Error('CI runs the S3 storage tests: set S3_ENDPOINT and the S3 credentials.');
}

let workdir: string;
let source: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'fld-storage-'));
  source = join(workdir, 'source.txt');
  await writeFile(source, CONTENT);
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** What every driver must do, on keys under a prefix of its own. */
function behavesAsStorage(storage: () => Storage) {
  const prefix = `test/${randomUUID()}`;
  const written: string[] = [];
  const put = async (name: string) => {
    const key = `${prefix}/${name}`;
    written.push(key);
    await storage().put(key, source, PUT);
    return key;
  };

  afterAll(async () => {
    await Promise.all(written.map((key) => storage().remove(key)));
  });

  it('reads back what it stored, whole or a range of it', async () => {
    const key = await put('whole');

    expect(await text(await storage().read(key))).toBe(CONTENT);
    expect(await text(await storage().read(key, { start: 2, end: 5 }))).toBe('2345');
  });

  it('copies an object into one that outlives the original', async () => {
    const original = await put('original');
    const copy = `${prefix}/copy`;
    written.push(copy);

    await storage().copy(original, copy);
    await storage().remove(original);

    expect(await text(await storage().read(copy))).toBe(CONTENT);
  });

  it('reports objects that are gone, and removes them more than once', async () => {
    const key = await put('removed');

    await storage().remove(key);
    await storage().remove(key);

    await expect(storage().read(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(storage().copy(key, `${prefix}/nowhere`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('refuses keys that could point outside its own objects', async () => {
    for (const key of ['../escape', '/absolute', `${prefix}/../x`, 'a//b', '.hidden', 'a/']) {
      await expect(storage().read(key)).rejects.toThrow('Invalid storage key');
    }
  });
}

describe('LocalStorage', () => {
  let storage: Storage;

  beforeAll(() => {
    storage = new LocalStorage(join(workdir, 'objects'));
  });

  behavesAsStorage(() => storage);

  it('leaves downloads to the API', async () => {
    expect(
      await storage.signedUrl('any', {
        expiresIn: 60,
        contentType: 'text/plain',
        contentDisposition: DISPOSITION,
      }),
    ).toBeUndefined();
  });
});

describe.skipIf(!env.S3_ENDPOINT)('S3Storage', () => {
  const options: S3StorageOptions = {
    bucket: TEST_BUCKET,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
    signedDownloads: true,
  };
  const storage = new S3Storage(options);

  beforeAll(async () => {
    const { endpoint, region, forcePathStyle, credentials } = options;
    const client = new S3Client({ endpoint, region, forcePathStyle, credentials });
    try {
      await client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
    } finally {
      client.destroy();
    }
  });

  afterAll(() => {
    storage.onModuleDestroy();
  });

  behavesAsStorage(() => storage);

  it('signs download URLs that answer with the headers asked for', async () => {
    const key = `test/${randomUUID()}/signed`;
    await storage.put(key, source, PUT);
    try {
      const url = await storage.signedUrl(key, {
        expiresIn: 60,
        contentType: 'text/plain; charset=utf-8',
        contentDisposition: DISPOSITION,
      });
      const response = await fetch(url ?? '');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(DISPOSITION);
      expect(await response.text()).toBe(CONTENT);
    } finally {
      await storage.remove(key);
    }
  });

  it('leaves downloads to the API when signed downloads are off', async () => {
    const unsigned = new S3Storage({ ...options, signedDownloads: false });

    expect(
      await unsigned.signedUrl('any', {
        expiresIn: 60,
        contentType: 'text/plain',
        contentDisposition: DISPOSITION,
      }),
    ).toBeUndefined();
    unsigned.onModuleDestroy();
  });
});
