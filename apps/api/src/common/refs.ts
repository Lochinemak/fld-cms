import type { UserRef } from '@fld/shared';

export function toUserRef(user: { id: bigint; displayName: string }): UserRef {
  return { id: user.id.toString(), displayName: user.displayName };
}

export function toNamedRef(row: { id: bigint; name: string }): { id: string; name: string } {
  return { id: row.id.toString(), name: row.name };
}
