import type { CustomField, CustomFieldType } from '@fld/shared';
import { describe, expect, it } from 'vitest';
import { formatCustomValue } from './custom-fields';

const field = (type: CustomFieldType): CustomField => ({
  id: '1',
  entity: 'crm.customer',
  key: 'field',
  label: '字段',
  type,
  required: false,
  showInList: true,
  sort: 0,
  dictionary: null,
  options: [
    { id: '10', value: 'east', label: '华东', sort: 0, enabled: true },
    { id: '11', value: 'west', label: '华西', sort: 1, enabled: false },
  ],
});

describe('formatCustomValue', () => {
  it('shows a dash for a value never filled in', () => {
    expect(formatCustomValue(field('TEXT'), undefined)).toBe('—');
    expect(formatCustomValue(field('TEXT'), '')).toBe('—');
    expect(formatCustomValue(field('MULTI_SELECT'), [])).toBe('—');
  });

  it('labels the options of selects, disabled ones included', () => {
    expect(formatCustomValue(field('SELECT'), 'west')).toBe('华西');
    expect(formatCustomValue(field('MULTI_SELECT'), ['east', 'west'])).toBe('华东、华西');
  });

  it('writes yes or no, and numbers with separators', () => {
    expect(formatCustomValue(field('BOOLEAN'), true)).toBe('是');
    expect(formatCustomValue(field('BOOLEAN'), false)).toBe('否');
    expect(formatCustomValue(field('NUMBER'), 1234567)).toBe('1,234,567');
  });

  it('shows text as it is', () => {
    expect(formatCustomValue(field('TEXT'), '备注')).toBe('备注');
  });
});
