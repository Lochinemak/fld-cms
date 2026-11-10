import { SYSTEM_TENANT_ID, type AccountChoice } from '@fld/shared';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { generatePassword } from '../common/password.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { normalizeAccount } from './account-name.js';
import { CredentialsService } from './credentials.service.js';

const SYSTEM_TENANT = BigInt(SYSTEM_TENANT_ID);

export type PreparedAccount =
  | { mode: 'existing'; account: string }
  | {
      mode: 'new';
      data: {
        id: bigint;
        username: string;
        email: string | null;
        displayName: string;
        passwordHash: string;
        mustChangePassword: true;
      };
      /** Set when the password was generated rather than given. */
      initialPassword: string | undefined;
    };

export interface ProvisionedAccount {
  id: bigint;
  username: string;
  /** Present only for a new account whose password was generated: shown this once. */
  initialPassword?: string;
}

/** Finds the existing account an {@link AccountChoice} names, or creates the new one it describes. */
@Injectable()
export class AccountProvisioning {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly snowflake: SnowflakeService,
  ) {}

  /**
   * Does the slow part ahead of the transaction: hashing a new account's password, which is the
   * one given or a generated one. Either way it must be changed at first sign-in.
   */
  async prepare(choice: AccountChoice): Promise<PreparedAccount> {
    if (choice.mode === 'existing') {
      return { mode: 'existing', account: normalizeAccount(choice.account) };
    }
    const password = choice.password ?? generatePassword();
    return {
      mode: 'new',
      initialPassword: choice.password ? undefined : password,
      data: {
        id: this.snowflake.next(),
        username: choice.username,
        email: choice.email ?? null,
        displayName: choice.displayName,
        passwordHash: await this.credentials.hash(password),
        mustChangePassword: true,
      },
    };
  }

  /**
   * Returns the account that joins a tenant other than the system tenant. The system tenant's own
   * accounts never do: they only manage tenants.
   */
  async provision(
    tx: Prisma.TransactionClient,
    prepared: PreparedAccount,
  ): Promise<ProvisionedAccount> {
    if (prepared.mode === 'existing') {
      const found = await tx.user.findFirst({
        where: {
          OR: [{ username: prepared.account }, { email: prepared.account }],
          status: 'ACTIVE',
        },
        select: {
          id: true,
          username: true,
          memberships: { where: { tenantId: SYSTEM_TENANT }, select: { id: true } },
        },
      });
      if (!found) {
        throw new BadRequestException('找不到该账号，或账号已停用');
      }
      if (found.memberships.length > 0) {
        throw new BadRequestException('超级管理员不能加入租户');
      }
      return { id: found.id, username: found.username };
    }
    const { username, email } = prepared.data;
    const taken = await tx.user.count({
      where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
    });
    if (taken) {
      throw new ConflictException('用户名或邮箱已被使用');
    }
    const created = await tx.user.create({
      data: prepared.data,
      select: { id: true, username: true },
    });
    return prepared.initialPassword
      ? { ...created, initialPassword: prepared.initialPassword }
      : created;
  }
}
