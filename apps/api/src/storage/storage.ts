import type { Readable } from 'node:stream';

/** Bytes `start` to `end` of an object, both included, as in an HTTP Range header. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface PutOptions {
  size: number;
  contentType: string;
}

export interface SignedUrlOptions {
  /** Seconds the URL stays valid. */
  expiresIn: number;
  /** The Content-Type and Content-Disposition the download is served with. */
  contentType: string;
  contentDisposition: string;
}

export class StorageObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Nothing is stored under ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/**
 * Where file contents live, under `/`-separated keys the API makes up. An object is written once
 * and never changed: new contents get a new key.
 */
export abstract class Storage {
  /** Stores the local file at `path` under `key`. */
  abstract put(key: string, path: string, options: PutOptions): Promise<void>;

  /** Rejects with StorageObjectNotFoundError when nothing is stored under `key`. */
  abstract read(key: string, range?: ByteRange): Promise<Readable>;

  /** Rejects with StorageObjectNotFoundError when nothing is stored under `from`. */
  abstract copy(from: string, to: string): Promise<void>;

  /** Succeeds when nothing is stored under `key` either. */
  abstract remove(key: string): Promise<void>;

  /** A URL browsers download the object from directly, or undefined when the API has to stream it. */
  abstract signedUrl(key: string, options: SignedUrlOptions): Promise<string | undefined>;
}

const KEY = /^[\w-]+(\.[\w-]+)*(\/[\w-]+(\.[\w-]+)*)*$/;

/** Keys are made of word characters, `-` and inner dots, which keeps `..` and absolute paths out. */
export function checkKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return key;
}
