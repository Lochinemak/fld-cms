import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** What the rest of a request, its logs and its audit records know about it. */
export interface RequestContext {
  /** Taken from the proxy's X-Request-Id when it sent a usable one, else generated. */
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  /** Filled in once the request is authenticated. */
  userId?: string;
  tenantId?: string;
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

const storage = new AsyncLocalStorage<RequestContext>();
const accessLog = new Logger('HTTP');

const USER_AGENT_LENGTH = 500;
const USABLE_REQUEST_ID = /^[\w.-]{8,64}$/;
/** Polled by the container's health check: logging each would drown the rest. */
const QUIET_PATHS = /^\/api\/health(\/|$)/;

/** An IPv4 address as people write it, not the IPv6 form a dual-stack server sees. */
export function readableIp(ip: string | undefined): string | null {
  return ip?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '') ?? null;
}

/**
 * Gives the request an id, returned in the X-Request-Id header, makes the id, the client's
 * address and browser readable for the rest of the request, and logs one line when it ends.
 * Mount it as module middleware: those run after the body parsers, whose callbacks would leave
 * the context.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const context: RequestContext = {
    requestId: incoming && USABLE_REQUEST_ID.test(incoming) ? incoming : randomUUID(),
    ip: readableIp(req.ip),
    userAgent: req.get('user-agent')?.slice(0, USER_AGENT_LENGTH) ?? null,
  };
  res.setHeader(REQUEST_ID_HEADER, context.requestId);
  const path = req.originalUrl.split('?', 1)[0]!;
  if (!QUIET_PATHS.test(path)) {
    const started = performance.now();
    res.once('finish', () => {
      const status = res.statusCode;
      const durationMs = Math.round(performance.now() - started);
      // The context by hand: an event listener may run outside it.
      const fields = { ...context, method: req.method, path, status, durationMs };
      const line = `${req.method} ${path} ${status} ${durationMs}ms`;
      if (status >= 500) {
        accessLog.error(line, fields);
      } else {
        accessLog.log(line, fields);
      }
    });
  }
  storage.run(context, next);
}

/** The current request's context, or undefined outside a request. */
export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}
