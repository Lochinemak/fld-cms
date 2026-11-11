import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { LogtoSignInError } from '@fld/shared';
import { ForbiddenException } from '@nestjs/common';
import type { SessionRecord } from '@nestjs/authentication';
import type { AuditActor } from '../audit/audit.service.js';

/** The provider's name: in the sign-in routes, and in the metadata of the sessions it signs in. */
export const LOGTO = 'logto';

export type LogtoRefusal = Extract<
  LogtoSignInError,
  'no-email' | 'no-account' | 'linked' | 'disabled' | 'locked'
>;

/** Refuses a sign-in with Logto, for a reason the sign-in page then gives. */
export class LogtoRefusedException extends ForbiddenException {
  constructor(readonly refusal: LogtoRefusal) {
    super();
  }
}

/** A sign-in coming back from Logto, where its request learns whom the resolver found. */
export interface LogtoAttempt {
  /** The account; without an id, what Logto says of someone who has none. Null until known. */
  actor: AuditActor | null;
}

/** The sign-in the current request is finishing, when it is Logto's callback. */
export const logtoAttempts = new AsyncLocalStorage<LogtoAttempt>();

/** Whether the session began with a sign-in through Logto. */
export function signedInWithLogto(session: SessionRecord): boolean {
  return session.metadata?.['method'] === LOGTO;
}

/**
 * What a Logto user's link to an account is filed under. It tells Logto instances apart, since a
 * user ID means something only where it was issued: once Logto's address changes, the links made
 * with the old one no longer count.
 */
export function logtoIdentityProvider(issuer: string): string {
  return `${LOGTO}:${createHash('sha256').update(issuer).digest('hex').slice(0, 32)}`;
}
