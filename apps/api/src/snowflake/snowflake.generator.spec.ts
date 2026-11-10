import { decodeSnowflake, SNOWFLAKE_EPOCH, SnowflakeGenerator } from './snowflake.generator.js';

const T0 = Number(SNOWFLAKE_EPOCH) + 1_000;

function clock(start: number) {
  let now = start;
  return {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
  };
}

describe('SnowflakeGenerator', () => {
  it('packs the timestamp, worker id and sequence', () => {
    const time = clock(T0);
    const generator = new SnowflakeGenerator(513, time.now);

    expect(decodeSnowflake(generator.next())).toEqual({
      timestamp: T0,
      workerId: 513,
      sequence: 0,
    });
    expect(decodeSnowflake(generator.next())).toEqual({
      timestamp: T0,
      workerId: 513,
      sequence: 1,
    });

    time.set(T0 + 5);
    expect(decodeSnowflake(generator.next())).toEqual({
      timestamp: T0 + 5,
      workerId: 513,
      sequence: 0,
    });
  });

  it('moves to the next millisecond when one runs out of sequence numbers', () => {
    const generator = new SnowflakeGenerator(1, clock(T0).now);
    const ids = Array.from({ length: 4097 }, () => generator.next());

    expect(new Set(ids).size).toBe(4097);
    expect(decodeSnowflake(ids[4095]!)).toMatchObject({ timestamp: T0, sequence: 4095 });
    expect(decodeSnowflake(ids[4096]!)).toMatchObject({ timestamp: T0 + 1, sequence: 0 });
  });

  it('keeps ids increasing when the clock steps back', () => {
    const time = clock(T0 + 100);
    const generator = new SnowflakeGenerator(7, time.now);
    const before = generator.next();

    time.set(T0);
    const after = generator.next();

    expect(after).toBeGreaterThan(before);
    expect(decodeSnowflake(after)).toMatchObject({ timestamp: T0 + 100, sequence: 1 });
  });

  it('rejects worker ids outside 0–1023', () => {
    expect(() => new SnowflakeGenerator(1024)).toThrow(RangeError);
    expect(() => new SnowflakeGenerator(-1)).toThrow(RangeError);
  });

  it('fits in a signed 64-bit integer', () => {
    const generator = new SnowflakeGenerator(1023, () => Number(SNOWFLAKE_EPOCH) + 2 ** 41 - 1);
    expect(generator.next()).toBeLessThanOrEqual(2n ** 63n - 1n);
  });
});
