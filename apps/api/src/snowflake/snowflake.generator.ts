/** 2026-01-01T00:00:00Z. Ids stay positive in a signed 64-bit column for about 69 years after it. */
export const SNOWFLAKE_EPOCH = 1_767_225_600_000n;
export const MAX_WORKER_ID = 1023;

const WORKER_SHIFT = 12n;
const TIMESTAMP_SHIFT = 22n;
const SEQUENCE_MASK = (1n << WORKER_SHIFT) - 1n;

/**
 * 41 bits of milliseconds since {@link SNOWFLAKE_EPOCH}, 10 bits of worker id, 12 bits of sequence.
 * Never waits: when the clock steps back or a millisecond's 4096 ids run out, it keeps counting on
 * a logical clock slightly ahead of the real one, so ids stay unique and increasing.
 */
export class SnowflakeGenerator {
  private lastTimestamp = -1n;
  private sequence = 0n;
  private workerBits: bigint;

  constructor(
    workerId: number,
    private readonly now: () => number = Date.now,
  ) {
    this.workerBits = toWorkerBits(workerId);
  }

  get workerId(): number {
    return Number(this.workerBits >> WORKER_SHIFT);
  }

  set workerId(workerId: number) {
    this.workerBits = toWorkerBits(workerId);
  }

  next(): bigint {
    let timestamp = BigInt(this.now());
    if (timestamp <= this.lastTimestamp) {
      timestamp = this.lastTimestamp;
      this.sequence = (this.sequence + 1n) & SEQUENCE_MASK;
      if (this.sequence === 0n) {
        timestamp += 1n;
      }
    } else {
      this.sequence = 0n;
    }
    this.lastTimestamp = timestamp;
    return ((timestamp - SNOWFLAKE_EPOCH) << TIMESTAMP_SHIFT) | this.workerBits | this.sequence;
  }
}

export function decodeSnowflake(id: bigint) {
  return {
    timestamp: Number((id >> TIMESTAMP_SHIFT) + SNOWFLAKE_EPOCH),
    workerId: Number((id >> WORKER_SHIFT) & BigInt(MAX_WORKER_ID)),
    sequence: Number(id & SEQUENCE_MASK),
  };
}

function toWorkerBits(workerId: number): bigint {
  if (!Number.isInteger(workerId) || workerId < 0 || workerId > MAX_WORKER_ID) {
    throw new RangeError(`Snowflake worker id must be an integer from 0 to ${MAX_WORKER_ID}`);
  }
  return BigInt(workerId) << WORKER_SHIFT;
}
