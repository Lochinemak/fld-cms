import { TENANT_HEADER, TENANT_SWITCHED_ERROR } from '@fld/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
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
  if (status === 429) {
    return '操作太频繁，请稍后再试';
  }
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) {
    return message.join('；');
  }
  return typeof message === 'string' ? message : `请求失败（${status}）`;
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
    if (
      res.status === 409 &&
      (body as { error?: unknown } | undefined)?.error === TENANT_SWITCHED_ERROR
    ) {
      window.location.reload();
    }
    throw new ApiError(res.status, errorMessage(res.status, body), body);
  }
  return schema ? schema.parse(body) : (body as T);
}
