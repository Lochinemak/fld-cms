import type { PasswordHasher } from '@nestjs/authentication';
import { generatePassword } from '../common/password.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { normalizeAccount } from './account-name.js';

/**
 * Gives the account a generated password, which must be changed at the next sign-in, and signs
 * it out everywhere. Null when no account has that username or email.
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
      data: { passwordHash, mustChangePassword: true },
    }),
    prisma.session.deleteMany({ where: { userId: user.id.toString() } }),
  ]);
  return { username: user.username, password };
}
