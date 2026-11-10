import { authenticationStoreContract } from '@nestjs/authentication/testing';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaSessionStore } from '../src/auth/prisma-session.store.js';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// The package's own rules for session stores, races included, on the real database.
describe('PrismaSessionStore (e2e)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
      providers: [PrismaSessionStore],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.get(PrismaService).session.deleteMany();
    await moduleRef.close();
  });

  const cases = authenticationStoreContract(
    async () => {
      await moduleRef.get(PrismaService).session.deleteMany();
      return { sessions: moduleRef.get(PrismaSessionStore) };
    },
    { contracts: ['sessions'], concurrent: true },
  );
  for (const contractCase of cases) {
    it(contractCase.name, () => contractCase.run());
  }
});
