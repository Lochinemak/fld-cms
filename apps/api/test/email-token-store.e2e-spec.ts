import { authenticationStoreContract } from '@nestjs/authentication/testing';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaEmailTokenStore } from '../src/auth/prisma-email-token.store.js';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// The package's own rules for email token stores, races included, on the real database.
describe('PrismaEmailTokenStore (e2e)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
      providers: [PrismaEmailTokenStore],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.get(PrismaService).emailToken.deleteMany();
    await moduleRef.close();
  });

  const cases = authenticationStoreContract(
    async () => {
      await moduleRef.get(PrismaService).emailToken.deleteMany();
      return { emailTokens: moduleRef.get(PrismaEmailTokenStore) };
    },
    { contracts: ['emailTokens'], concurrent: true },
  );
  for (const contractCase of cases) {
    it(contractCase.name, () => contractCase.run());
  }
});
