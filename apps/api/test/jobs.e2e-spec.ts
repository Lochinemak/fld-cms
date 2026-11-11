import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { QueueEvents, type Queue } from 'bullmq';
import type { App } from 'supertest/types.js';
import { AUDIT_QUEUE, REMOVE_EXPIRED_AUDIT_LOGS } from '../src/audit/audit.processor.js';
import { FILES_QUEUE, PURGE_DELETED_FILES } from '../src/files/files.processor.js';
import { redisOptions } from '../src/jobs/jobs.module.js';
import { createTestApp } from './app.js';
import { testEnv } from './test-env.js';

// The background jobs run in the API's own workers, through BullMQ.
describe('Background jobs (e2e)', () => {
  let app: INestApplication<App>;
  const events: QueueEvents[] = [];

  const run = async (name: string, jobName: string) => {
    const queue = app.get<Queue>(getQueueToken(name));
    const queueEvents = new QueueEvents(name, {
      connection: redisOptions(testEnv().REDIS_URL),
      prefix: 'fld:jobs',
    });
    events.push(queueEvents);
    await queueEvents.waitUntilReady();
    const job = await queue.add(jobName, {});
    return job.waitUntilFinished(queueEvents, 15_000);
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await Promise.all(events.map((queueEvents) => queueEvents.close()));
    await app.close();
  });

  it('schedules nothing in the tests', async () => {
    for (const name of [FILES_QUEUE, AUDIT_QUEUE]) {
      expect(await app.get<Queue>(getQueueToken(name)).getJobSchedulers()).toEqual([]);
    }
  });

  it('purges deleted files', async () => {
    expect(await run(FILES_QUEUE, PURGE_DELETED_FILES)).toEqual({ files: 0, folders: 0 });
  });

  it('removes expired audit records', async () => {
    expect(await run(AUDIT_QUEUE, REMOVE_EXPIRED_AUDIT_LOGS)).toEqual({
      removed: expect.any(Number),
    });
  });
});
