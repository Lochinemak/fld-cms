import type { Queue } from 'bullmq';

/**
 * Makes the queue run `jobName` every `every` milliseconds, unless in the tests, which run jobs
 * when they choose to. Idempotent: every instance calls it at start, and there stays one schedule.
 */
export async function scheduleEvery(
  queue: Queue,
  jobName: string,
  every: number,
  nodeEnv: string,
): Promise<void> {
  if (nodeEnv === 'test') {
    return;
  }
  await queue.upsertJobScheduler(jobName, { every }, { name: jobName });
}
