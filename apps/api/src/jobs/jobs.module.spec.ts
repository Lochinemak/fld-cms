import { redisOptions } from './jobs.module.js';

describe('redisOptions', () => {
  it('reads the host, port and database index', () => {
    expect(redisOptions('redis://127.0.0.1:16379/1')).toEqual({
      host: '127.0.0.1',
      port: 16379,
      db: 1,
    });
  });

  it('reads credentials and TLS, with defaults for the rest', () => {
    expect(redisOptions('rediss://app:p%40ss@cache.example.com')).toEqual({
      host: 'cache.example.com',
      port: 6379,
      username: 'app',
      password: 'p@ss',
      db: 0,
      tls: {},
    });
  });
});
