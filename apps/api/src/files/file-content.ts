import { pipeline } from 'node:stream/promises';
import { extensionOf, PREVIEW_MIME_TYPES } from '@fld/shared';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Storage, StorageObjectNotFoundError } from '../storage/storage.js';

const MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  htm: 'text/html',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/**
 * The type a file is served as, from its extension rather than what the uploader's browser
 * claimed, so that only real previewable types ever display inline.
 */
export function mimeTypeOf(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}

/** A Content-Disposition header naming the file, with an ASCII fallback for old clients. */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export interface FileContent {
  name: string;
  storageKey: string;
  size: bigint;
  mimeType: string;
}

const SIGNED_URL_SECONDS = 300;

const logger = new Logger('FileContent');

/**
 * Answers the request with the contents. Previewable types display in the browser unless
 * `download` is set; everything else is saved. Drivers with signed URLs serve it themselves.
 */
export async function sendFileContent(
  storage: Storage,
  request: Request,
  response: Response,
  content: FileContent,
  download = false,
): Promise<void> {
  const inline = !download && PREVIEW_MIME_TYPES.has(content.mimeType);
  const disposition = contentDisposition(inline ? 'inline' : 'attachment', content.name);
  response.setHeader('Cache-Control', 'private, no-store');

  const url = await storage.signedUrl(content.storageKey, {
    expiresIn: SIGNED_URL_SECONDS,
    contentType: content.mimeType,
    contentDisposition: disposition,
  });
  if (url) {
    response.redirect(302, url);
    return;
  }

  const size = Number(content.size);
  const ranges = size > 0 ? request.range(size, { combine: true }) : undefined;
  if (ranges === -1) {
    response.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    return;
  }
  const range = Array.isArray(ranges) && ranges.length === 1 ? ranges[0] : undefined;

  let body;
  try {
    body = await storage.read(content.storageKey, range);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new NotFoundException('文件内容不存在');
    }
    throw error;
  }
  response.status(range ? 206 : 200);
  response.setHeader('Content-Type', content.mimeType);
  response.setHeader('Content-Disposition', disposition);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
  if (range) {
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  }
  try {
    await pipeline(body, response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.error(`Streaming ${content.storageKey} failed`, error);
    }
  }
}
