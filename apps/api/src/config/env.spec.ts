import { envSchema } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('envSchema', () => {
  it('applies defaults', () => {
    const env = envSchema.parse(required);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
  });

  it('coerces string values from the environment', () => {
    const env = envSchema.parse({ ...required, PORT: '8080', SWAGGER_ENABLED: 'false' });

    expect(env.PORT).toBe(8080);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('rejects connection strings for other databases', () => {
    const result = envSchema.safeParse({ ...required, DATABASE_URL: 'mysql://localhost/app' });

    expect(result.success).toBe(false);
  });
});
