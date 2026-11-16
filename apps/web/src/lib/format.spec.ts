import { describe, expect, it } from 'vitest';
import { formatAmount, fromLocalInput, toLocalInput } from './crm';
import { formatSize } from './files';
import { formatNotificationTime } from './notifications';
import { listPath } from './system';

describe('formatAmount', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatAmount('1234567.5')).toBe('1,234,567.50');
    expect(formatAmount('0')).toBe('0.00');
    expect(formatAmount('999')).toBe('999.00');
    expect(formatAmount('1000.25')).toBe('1,000.25');
  });

  it('keeps every digit of an amount too large for a float', () => {
    expect(formatAmount('123456789012.34')).toBe('123,456,789,012.34');
  });
});

describe('formatSize', () => {
  it('picks the unit people read', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(10 * 1024)).toBe('10 KB');
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB');
    expect(formatSize(2048 * 1024 ** 4)).toBe('2048 TB');
  });
});

describe('formatNotificationTime', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it('says roughly how long ago within a day', () => {
    expect(formatNotificationTime(ago(0), now)).toBe('刚刚');
    expect(formatNotificationTime(ago(5), now)).toBe('5 分钟前');
    expect(formatNotificationTime(ago(59), now)).toBe('59 分钟前');
    expect(formatNotificationTime(ago(60), now)).toBe('1 小时前');
    expect(formatNotificationTime(ago(23 * 60 + 59), now)).toBe('23 小时前');
  });

  it('gives the date after that', () => {
    expect(formatNotificationTime(ago(24 * 60), now)).toMatch(/2026\/11\/1[45]/);
  });
});

describe('local datetime inputs', () => {
  it('round-trip a time through the input', () => {
    const time = new Date('2026-11-16T08:30:00Z');
    expect(fromLocalInput(toLocalInput(time))).toBe(time.toISOString());
  });

  it('read an empty input as no time', () => {
    expect(fromLocalInput('')).toBeUndefined();
    expect(fromLocalInput(null)).toBeUndefined();
  });
});

describe('listPath', () => {
  it('adds the page size and the filters that are set', () => {
    expect(
      listPath('/crm/customers', {
        page: 2,
        keyword: '张 三',
        status: undefined,
        level: '',
        mine: true,
        sort: 'name',
        order: 'desc',
      }),
    ).toBe(
      '/crm/customers?pageSize=20&page=2&keyword=%E5%BC%A0+%E4%B8%89&mine=true&sort=name&order=desc',
    );
  });
});
