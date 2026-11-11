import { Module } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { NestFactory } from '@nestjs/core';
import { resetMfa, resetPassword } from './auth/reset-password.js';
import { AppConfigModule } from './config/app-config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaService } from './prisma/prisma.service.js';

const USAGE = 'Usage: node dist/cli.js reset-password|reset-mfa <username or email>';

@Module({ imports: [AppConfigModule, PrismaModule] })
class CliModule {}

async function main([command, account]: string[]): Promise<number> {
  if ((command !== 'reset-password' && command !== 'reset-mfa') || !account) {
    console.error(USAGE);
    return 2;
  }
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    if (command === 'reset-mfa') {
      const username = await resetMfa(prisma, account);
      if (!username) {
        console.error(`No account has the username or email "${account}".`);
        return 1;
      }
      console.log(`Two-step sign-in is off for "${username}": the password alone signs in.`);
      return 0;
    }
    const result = await resetPassword(prisma, new PasswordHasher(), account);
    if (!result) {
      console.error(`No account has the username or email "${account}".`);
      return 1;
    }
    console.log(
      `New password for "${result.username}" (must be changed at the next sign-in): ${result.password}`,
    );
    return 0;
  } finally {
    await app.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
