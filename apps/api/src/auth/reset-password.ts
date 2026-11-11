import type { PasswordHasher } from '@nestjs/authentication';
import { generatePassword } from '../common/password.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { normalizeAccount } from './account-name.js';
import { UNLOCKED } from './credentials.service.js';

/**
 * Gives the account a generated password, which must be changed at the next sign-in, unlocks it,
 * and signs it out everywhere. Null when no account has that username or email.
 */
export async function resetPassword(
  prisma: PrismaService,
  passwordHasher: PasswordHasher,
  account: string,
): Promise<{ username: string; password: string } | null> {
  const normalized = normalizeAccount(account);
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: normalized }, { email: normalized }] },
    select: { id: true, username: true },
  });
  if (!user) {
    return null;
  }
  const password = generatePassword();
  const passwordHash = await passwordHasher.hash(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, ...UNLOCKED },
    }),
    prisma.session.deleteMany({ where: { userId: user.id.toString() } }),
  ]);
  return { username: user.username, password };
}

/**
 * Turns off the account's two-step sign-in, for whoever lost the phone and the recovery codes with
 * no administrator to reset it. Its username, or null when no account has that username or email.
 */
export async function resetMfa(prisma: PrismaService, account: string): Promise<string | null> {
  const normalized = normalizeAccount(account);
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: normalized }, { email: normalized }] },
    select: { id: true, username: true },
  });
  if (!user) {
    return null;
  }
  const userId = user.id.toString();
  await prisma.$transaction([
    prisma.userTotp.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  return user.username;
}
