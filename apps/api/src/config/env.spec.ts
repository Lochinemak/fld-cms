import { envSchema } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('envSchema', () => {
  it('applies defaults', () => {
    const env = envSchema.parse(required);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3011);
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

  describe('TRUST_PROXY', () => {
    const trustProxy = (value?: string) =>
      envSchema.parse({ ...required, TRUST_PROXY: value }).TRUST_PROXY;

    it('trusts no proxy when unset, blank or false', () => {
      expect(trustProxy()).toBe(false);
      expect(trustProxy('  ')).toBe(false);
      expect(trustProxy('false')).toBe(false);
    });

    it('reads true and hop counts the way Express expects them', () => {
      expect(trustProxy('true')).toBe(true);
      expect(trustProxy('1')).toBe(1);
    });

    it('passes addresses and subnet names through', () => {
      expect(trustProxy(' loopback, uniquelocal ')).toBe('loopback, uniquelocal');
    });
  });

  describe('storage', () => {
    const s3 = { STORAGE_DRIVER: 's3', S3_BUCKET: 'files' };

    it('keeps files on local disk by default', () => {
      const env = envSchema.parse(required);

      expect(env.STORAGE_DRIVER).toBe('local');
      expect(env.STORAGE_LOCAL_DIR).toBe('storage');
      expect(env.FILE_MAX_SIZE_MB).toBe(100);
    });

    it('needs a bucket for the s3 driver', () => {
      expect(envSchema.safeParse({ ...required, STORAGE_DRIVER: 's3' }).success).toBe(false);
      expect(envSchema.parse({ ...required, ...s3 }).S3_SIGNED_DOWNLOADS).toBe(true);
    });

    it('takes the access key id and secret together or not at all', () => {
      const keyOnly = envSchema.safeParse({ ...required, ...s3, S3_ACCESS_KEY_ID: 'id' });
      const both = envSchema.safeParse({
        ...required,
        ...s3,
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      });

      expect(keyOnly.success).toBe(false);
      expect(both.success).toBe(true);
    });
  });

  describe('mail', () => {
    it('leaves mail unset by default', () => {
      const env = envSchema.parse(required);

      expect(env.SMTP_HOST).toBeUndefined();
      expect(env.SITE_URL).toBeUndefined();
      expect(env.SETTINGS_ENCRYPTION_KEY).toBeUndefined();
    });

    it('takes the site address without its trailing slash, over http or https only', () => {
      const siteUrl = (value: string) => envSchema.safeParse({ ...required, SITE_URL: value });

      expect(siteUrl('https://crm.example.com/').data?.SITE_URL).toBe('https://crm.example.com');
      expect(siteUrl('ftp://crm.example.com').success).toBe(false);
    });

    it('takes an encryption key of 32 bytes only', () => {
      const key = (bytes: number) =>
        envSchema.safeParse({
          ...required,
          SETTINGS_ENCRYPTION_KEY: Buffer.alloc(bytes, 1).toString('base64'),
        }).success;

      expect(key(32)).toBe(true);
      expect(key(16)).toBe(false);
    });
  });

  describe('Logto', () => {
    it('counts an empty variable as unset', () => {
      const env = envSchema.parse({
        ...required,
        LOGTO_AUTH_URL: '',
        LOGTO_APP_ID: '',
        LOGTO_APP_SECRET: '',
      });

      expect(env.LOGTO_AUTH_URL).toBeUndefined();
      expect(env.LOGTO_APP_ID).toBeUndefined();
      expect(env.LOGTO_APP_SECRET).toBeUndefined();
    });

    it('takes its address without a trailing slash, over https unless it is on this machine', () => {
      const url = (value: string) => envSchema.safeParse({ ...required, LOGTO_AUTH_URL: value });

      expect(url('https://auth.example.com/').data?.LOGTO_AUTH_URL).toBe(
        'https://auth.example.com',
      );
      expect(url('http://localhost:3001').data?.LOGTO_AUTH_URL).toBe('http://localhost:3001');
      expect(url('http://auth.example.com').success).toBe(false);
    });
  });

  describe('AUDIT_RETENTION_DAYS', () => {
    it('keeps audit records for a year by default, and never less than 180 days', () => {
      const days = (value?: string) =>
        envSchema.safeParse({ ...required, AUDIT_RETENTION_DAYS: value });

      expect(days().data?.AUDIT_RETENTION_DAYS).toBe(365);
      expect(days('180').data?.AUDIT_RETENTION_DAYS).toBe(180);
      expect(days('90').success).toBe(false);
    });
  });
});
