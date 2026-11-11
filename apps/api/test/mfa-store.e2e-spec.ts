import { authenticationStoreContract } from '@nestjs/authentication/testing';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaMfaStore } from '../src/auth/mfa.store.js';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisModule } from '../src/redis/redis.module.js';
import { RedisService } from '../src/redis/redis.service.js';

// The package's own rules for second-factor stores, races included, on the real database and Redis.
describe('PrismaMfaStore (e2e)', () => {
  let moduleRef: TestingModule;

  const empty = async () => {
    const prisma = moduleRef.get(PrismaService);
    await prisma.userTotp.deleteMany();
    await prisma.mfaRecoveryCode.deleteMany();
    const redis = moduleRef.get(RedisService);
    const keys = await redis.keys('fld:mfa-failures:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, RedisModule],
      providers: [PrismaMfaStore],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await empty();
    await moduleRef.close();
  });

  const cases = authenticationStoreContract(
    async () => {
      await empty();
      return { mfa: moduleRef.get(PrismaMfaStore) };
    },
    { contracts: ['mfa'], concurrent: true },
  );
  for (const contractCase of cases) {
    it(contractCase.name, () => contractCase.run());
  }
});
