import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  OidcAccountResolver,
  type OAuthTokens,
  type OidcProfile,
  type OidcResolveContext,
} from '@nestjs/authentication';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { logtoAttempts, logtoIdentityProvider, LogtoRefusedException } from './logto.js';

const accountSelect = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  status: true,
  lockedAt: true,
} satisfies Prisma.UserSelect;

type Account = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

/**
 * Finds the account of whoever signed in with Logto: the one their Logto user is linked to, or,
 * the first time, the one with their email address, which gets linked. Logto has to have
 * verified the address. Ours never was, but whoever reads its mail can reset the password
 * anyway, so the address already decides whose the account is. Nobody gets an account by signing
 * in: an administrator makes them.
 */
@Injectable()
export class LogtoAccountResolver extends OidcAccountResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('oidc', this);
  }

  async resolveUser(
    profile: OidcProfile,
    _tokens: OAuthTokens,
    context: OidcResolveContext,
  ): Promise<{ id: string } | null> {
    // Accounts are linked by a first sign-in only, not from a signed-in account.
    if (context.linkTo) {
      return null;
    }
    const attempt = logtoAttempts.getStore();
    const provider = logtoIdentityProvider(String(profile.claims['iss']));
    const { subject } = profile;
    if (attempt) {
      attempt.actor = {
        id: null,
        username: profile.email ?? subject,
        displayName: profile.name ?? '',
      };
    }
    const linked = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      select: { user: { select: accountSelect } },
    });
    const account = linked?.user ?? (await this.accountByEmail(provider, profile));
    if (attempt) {
      attempt.actor = account;
    }
    if (account.status !== 'ACTIVE') {
      throw new LogtoRefusedException('disabled');
    }
    if (account.lockedAt) {
      throw new LogtoRefusedException('locked');
    }
    if (!linked) {
      // Two first sign-ins at once both get here: the second finds the link made.
      await this.prisma.userIdentity.upsert({
        where: { provider_subject: { provider, subject } },
        create: {
          id: this.snowflake.next(),
          userId: account.id,
          provider,
          subject,
          email: account.email,
        },
        update: {},
      });
    }
    return { id: account.id.toString() };
  }

  /** The account with the address Logto verified, unless another Logto user has it already. */
  private async accountByEmail(provider: string, profile: OidcProfile): Promise<Account> {
    const email = profile.emailVerified ? profile.email?.trim().toLowerCase() : undefined;
    if (!email) {
      throw new LogtoRefusedException('no-email');
    }
    const account = await this.prisma.user.findUnique({
      where: { email },
      select: { ...accountSelect, identities: { where: { provider }, select: { id: true } } },
    });
    if (!account) {
      throw new LogtoRefusedException('no-account');
    }
    if (account.identities.length > 0) {
      throw new LogtoRefusedException('linked');
    }
    return account;
  }
}
