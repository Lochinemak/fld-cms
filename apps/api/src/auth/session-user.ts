import type { Prisma } from '../generated/prisma/client.js';
import type { SessionUser } from './principal.js';

export const sessionUserSelect = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  mustChangePassword: true,
  status: true,
  lastTenantId: true,
} satisfies Prisma.UserSelect;

export type SessionUserRow = Prisma.UserGetPayload<{ select: typeof sessionUserSelect }>;

export function toSessionUser(row: SessionUserRow): SessionUser {
  return {
    id: row.id.toString(),
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    mustChangePassword: row.mustChangePassword,
    active: row.status === 'ACTIVE',
    lastTenantId: row.lastTenantId?.toString() ?? null,
  };
}
