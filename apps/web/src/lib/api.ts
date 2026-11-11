import { TENANT_HEADER, TENANT_SWITCHED_ERROR } from '@fld/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** The API's id for the request, which finds it in the API's log. */
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown, requestId: string | null = null) {
    super(message);
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

let currentTenantId: string | null = null;

/**
 * The tenant this page shows. Requests about tenant data carry it, so the API refuses them once
 * another tab has switched the session to another tenant.
 */
export function setCurrentTenant(tenantId: string | null): void {
  currentTenantId = tenantId;
}

export function currentTenant(): string | null {
  return currentTenantId;
}

const ACCOUNT_PATH = /^\/(auth|me)(\/|$)/;

function errorMessage(status: number, body: unknown): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) {
    return message.join('；');
  }
  if (typeof message === 'string') {
    return message;
  }
  // The proxy in front of the API refuses too, without a message: too many requests, or an upload
  // over its own limit.
  if (status === 429) {
    return '操作太频繁，请稍后再试';
  }
  return status === 413 ? '文件太大，超过了上传上限' : `请求失败（${status}）`;
}

function failure(status: number, body: unknown, requestId: string | null): ApiError {
  if (
    status === 409 &&
    (body as { error?: unknown } | undefined)?.error === TENANT_SWITCHED_ERROR
  ) {
    window.location.reload();
  }
  const message = errorMessage(status, body);
  // An error of the server's own is one to report: the id finds it in the API's log.
  const reported =
    status >= 500 && requestId ? `${message}（请求 ID：${requestId.slice(0, 8)}）` : message;
  return new ApiError(status, reported, body, requestId);
}

interface ApiOptions<T> extends Omit<RequestInit, 'body'> {
  json?: unknown;
  schema?: z.ZodType<T>;
}

export async function api<T = void>(path: string, options: ApiOptions<T> = {}): Promise<T> {
  const { json, schema, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (currentTenantId && !ACCOUNT_PATH.test(path)) {
    headers.set(TENANT_HEADER, currentTenantId);
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    throw failure(res.status, body, res.headers.get('X-Request-Id'));
  }
  return schema ? schema.parse(body) : (body as T);
}

interface UploadOptions<T> {
  schema?: z.ZodType<T>;
  /** Called as the file goes out, with the bytes sent so far. */
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
}

/** Posts a file as the form field `file`. Unlike `api`, it reports how far the upload has got. */
export function upload<T = void>(
  path: string,
  file: File,
  { schema, onProgress, signal }: UploadOptions<T> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (currentTenantId) {
      xhr.setRequestHeader(TENANT_HEADER, currentTenantId);
    }
    xhr.upload.onprogress = (event) => onProgress?.(event.loaded);
    xhr.onload = () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(failure(xhr.status, body, xhr.getResponseHeader('X-Request-Id')));
        return;
      }
      try {
        resolve(schema ? schema.parse(body) : (body as T));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    xhr.onerror = () => reject(new Error('网络出错，上传没有完成'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
