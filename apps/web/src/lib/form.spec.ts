import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fieldErrors, optionalText, parseForm, safeRedirect } from './form';

const schema = z.object({
  name: z.string().min(1, '请输入名称').max(3, '名称太长'),
  admin: z.object({ username: z.string().min(1, '请输入用户名') }),
});

describe('fieldErrors', () => {
  it('keys the first message of each field by its path', () => {
    const parsed = schema.safeParse({ name: '', admin: { username: '' } });
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!)).toEqual({
      name: '请输入名称',
      'admin.username': '请输入用户名',
    });
  });
});

describe('parseForm', () => {
  it('returns the input and clears the errors when the values pass', () => {
    const setErrors = vi.fn();
    const values = { name: 'abc', admin: { username: 'ann' } };
    expect(parseForm(schema, values, setErrors)).toEqual(values);
    expect(setErrors).toHaveBeenCalledWith({});
  });

  it('shows the errors and returns nothing when they do not', () => {
    const setErrors = vi.fn();
    expect(parseForm(schema, { name: 'abcd', admin: { username: 'ann' } }, setErrors)).toBe(
      undefined,
    );
    expect(setErrors).toHaveBeenCalledWith({ name: '名称太长' });
  });
});

describe('optionalText', () => {
  it('reads an empty or missing value as not given', () => {
    expect(optionalText('east')).toBe('east');
    expect(optionalText('')).toBeUndefined();
    expect(optionalText(null)).toBeUndefined();
  });
});

describe('safeRedirect', () => {
  it('keeps a path of this site', () => {
    expect(safeRedirect('/crm/customers?page=2')).toBe('/crm/customers?page=2');
  });

  it('never leaves for another origin', () => {
    for (const target of [undefined, '', 'https://evil.example', '//evil.example', '/\\evil']) {
      expect(safeRedirect(target)).toBe('/');
    }
  });
});
