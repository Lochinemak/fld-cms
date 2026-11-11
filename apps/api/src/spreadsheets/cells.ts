import { isEmptyCustomValue, type CustomField } from '@fld/shared';
import type { CellValue as ExcelCellValue } from 'exceljs';
import type { SheetColumn } from './spreadsheet-registry.js';

/** What an exported cell holds. Dates are written as dates, the rest as is. */
export type CellValue = string | number | boolean | Date | null;

/**
 * A cell of an uploaded sheet as the text it shows, trimmed: rich text joined, formulas by their
 * result, dates as YYYY-MM-DD, empty as ''.
 */
export function cellText(value: ExcelCellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('result' in value) {
      return cellText(value.result as ExcelCellValue);
    }
    if ('text' in value) {
      return String(value.text).trim();
    }
    return '';
  }
  return String(value).trim();
}

const YES = new Set(['是', 'y', 'yes', 'true', '1', '开', '√']);
const NO = new Set(['否', 'n', 'no', 'false', '0', '关', '×']);

/** 是/否 as people type them, or undefined for anything else. */
export function parseYesNo(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  return YES.has(lower) ? true : NO.has(lower) ? false : undefined;
}

/** Options people list in one cell: 华东、华南 / 华东,华南 / 华东；华南. */
export function splitList(text: string): string[] {
  return text
    .split(/[、,，;；\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A custom value as a cell: option labels for selects, 是/否, the rest as stored. */
export function customCell(field: CustomField, value: unknown): CellValue {
  if (isEmptyCustomValue(value)) {
    return null;
  }
  const label = (item: unknown) =>
    field.options.find((option) => option.value === item)?.label ?? String(item);
  switch (field.type) {
    case 'SELECT':
      return label(value);
    case 'MULTI_SELECT':
      return Array.isArray(value) ? value.map(label).join('、') : String(value);
    case 'BOOLEAN':
      return value === true ? '是' : '否';
    case 'NUMBER':
      return typeof value === 'number' ? value : String(value);
    default:
      return String(value);
  }
}

/**
 * The custom value a cell gives the field, or why it can't: options go by their label (or their
 * value), 是/否 by the words above. An empty cell leaves the field empty.
 */
export function customFromCell(
  field: CustomField,
  text: string,
): { value: unknown } | { error: string } {
  if (text === '') {
    // An empty cell leaves the field empty, 是/否 included: only what is written is imported.
    return { value: null };
  }
  const option = (part: string) =>
    field.options.find((item) => item.enabled && (item.label === part || item.value === part))
      ?.value;
  switch (field.type) {
    case 'NUMBER': {
      const number = Number(text.replaceAll(',', ''));
      return Number.isFinite(number) ? { value: number } : { error: `${field.label}应为数字` };
    }
    case 'BOOLEAN': {
      const yes = parseYesNo(text);
      return yes === undefined ? { error: `${field.label}应填“是”或“否”` } : { value: yes };
    }
    case 'SELECT': {
      const value = option(text);
      return value === undefined ? { error: `${field.label}没有“${text}”这个选项` } : { value };
    }
    case 'MULTI_SELECT': {
      const values = [];
      for (const part of splitList(text)) {
        const value = option(part);
        if (value === undefined) {
          return { error: `${field.label}没有“${part}”这个选项` };
        }
        values.push(value);
      }
      return { value: values };
    }
    case 'DATE': {
      // 2026-1-31 and 2026/1/31 as people type them, written the one way the field keeps.
      const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
      return match
        ? { value: `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}` }
        : { error: `${field.label}应为日期，如 2026-01-31` };
    }
    default:
      return { value: text };
  }
}

/** The note a template gives a custom field's column: what to type in it. */
export function customNote(field: CustomField): string {
  const enabled = field.options.filter((option) => option.enabled).map((option) => option.label);
  switch (field.type) {
    case 'NUMBER':
      return '数字';
    case 'DATE':
      return '日期，如 2026-01-31';
    case 'BOOLEAN':
      return '填“是”或“否”，不填就留空';
    case 'SELECT':
      return `选一个：${enabled.join('、')}`;
    case 'MULTI_SELECT':
      return `可选多个，用顿号隔开：${enabled.join('、')}`;
    default:
      return '文字';
  }
}

/**
 * A custom field's column in an import template: what to type in it and, when it takes one of a
 * list, a dropdown of the list. Every importer's custom fields go through here.
 */
export function customColumn(field: CustomField): SheetColumn {
  return {
    header: field.label,
    required: field.required,
    note: `${field.required ? '必填，' : ''}${customNote(field)}`,
    options: customOptions(field),
  };
}

/** The values a template's dropdown offers for a custom field, if it takes only one of a list. */
function customOptions(field: CustomField): string[] | undefined {
  switch (field.type) {
    case 'SELECT':
      return field.options.filter((option) => option.enabled).map((option) => option.label);
    case 'BOOLEAN':
      return ['是', '否'];
    default:
      // A multi-select takes several in one cell, which a dropdown can't.
      return undefined;
  }
}
