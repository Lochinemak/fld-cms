import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Where a request came from. */
export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestInfo>();

const USER_AGENT_LENGTH = 500;

/** An IPv4 address as people write it, not the IPv6 form a dual-stack server sees. */
function readableIp(ip: string | undefined): string | null {
  return ip?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '') ?? null;
}

/**
 * Makes the client's address and browser readable for the rest of the request. Mount it as
 * module middleware: those run after the body parsers, whose callbacks would leave the context.
 */
export function requestInfo(req: Request, _res: Response, next: NextFunction): void {
  const userAgent = req.get('user-agent')?.slice(0, USER_AGENT_LENGTH) ?? null;
  storage.run({ ip: readableIp(req.ip), userAgent }, next);
}

/** The current request's address and browser, or undefined outside a request. */
export function currentRequestInfo(): RequestInfo | undefined {
  return storage.getStore();
}
