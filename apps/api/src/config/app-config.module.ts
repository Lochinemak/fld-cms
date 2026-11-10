import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env.js';

export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  // Local development keeps one .env at the repo root; deployed containers receive real env vars.
  envFilePath: ['.env', '../../.env'],
  validationSchema: envSchema,
});
