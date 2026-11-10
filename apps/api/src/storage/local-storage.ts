import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { type ByteRange, checkKey, Storage, StorageObjectNotFoundError } from './storage.js';

/** Keeps each object as a file under one directory. */
export class LocalStorage extends Storage {
  private readonly root: string;

  constructor(directory: string) {
    super();
    this.root = resolve(directory);
  }

  async put(key: string, path: string): Promise<void> {
    await this.place(path, this.pathOf(key));
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    try {
      const file = await open(this.pathOf(key), 'r');
      return file.createReadStream(range && { start: range.start, end: range.end });
    } catch (error) {
      throw isNotFound(error) ? new StorageObjectNotFoundError(key) : error;
    }
  }

  async copy(from: string, to: string): Promise<void> {
    try {
      await this.place(this.pathOf(from), this.pathOf(to));
    } catch (error) {
      throw isNotFound(error) ? new StorageObjectNotFoundError(from) : error;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  signedUrl(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  private pathOf(key: string): string {
    return resolve(this.root, checkKey(key));
  }

  /** Writes next to `target` and renames, so readers never see half a file. */
  private async place(source: string, target: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.${randomUUID()}.part`;
    try {
      await copyFile(source, partial);
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
