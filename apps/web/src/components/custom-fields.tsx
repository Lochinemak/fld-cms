import {
  customValueError,
  isEmptyCustomValue,
  type CustomField,
  type CustomValues,
} from '@fld/shared';
import { FieldError } from '@/components/field-error';
import { SelectField } from '@/components/select-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { itemLabel, offeredItems } from '@/lib/custom-fields';
import type { FieldErrors } from '@/lib/form';
import { currentLocale } from '@/i18n';

/**
 * What the inputs hold, by field key: as the record has it, except numbers, which are the text
 * typed until the form is sent.
 */
export type CustomDraft = Record<string, unknown>;

/** The record's values as the inputs start out. */
export function customDraft(
  fields: readonly CustomField[],
  stored: CustomValues = {},
): CustomDraft {
  return Object.fromEntries(
    fields.map((field) => {
      const value = stored[field.key];
      if (field.type === 'BOOLEAN') {
        // A switch is on or off: one never touched is off, which is an answer, not a blank.
        return [field.key, value === true];
      }
      return [
        field.key,
        field.type === 'NUMBER' && typeof value === 'number' ? String(value) : value,
      ];
    }),
  );
}

/**
 * The values to send for the fields, an empty one as null to clear it, or the errors to show,
 * keyed `custom.<key>`. The server checks them again.
 */
export function readCustomValues(
  fields: readonly CustomField[],
  draft: CustomDraft,
  stored: CustomValues = {},
): { values: CustomValues; errors: FieldErrors } {
  const values: CustomValues = {};
  const errors: FieldErrors = {};
  for (const field of fields) {
    let value = draft[field.key];
    if (field.type === 'NUMBER' && typeof value === 'string') {
      value = value.trim() === '' ? null : Number(value);
    }
    if (typeof value === 'string' && field.type !== 'TEXTAREA') {
      value = value.trim();
    }
    if (isEmptyCustomValue(value)) {
      if (field.required) {
        errors[`custom.${field.key}`] = `请填写${field.label}`;
      }
      values[field.key] = null;
      continue;
    }
    const error = customValueError(field, value, stored[field.key]);
    if (error) {
      errors[`custom.${field.key}`] = error;
    }
    values[field.key] = value;
  }
  return { values, errors };
}

interface CustomFieldInputsProps {
  fields: readonly CustomField[];
  draft: CustomDraft;
  onChange: (draft: CustomDraft) => void;
  errors: FieldErrors;
  /** The record's values, whose options stay offered after being disabled. */
  stored?: CustomValues;
}

/** The inputs of a model's custom fields, in a form, two to a row. */
export function CustomFieldInputs({
  fields,
  draft,
  onChange,
  errors,
  stored = {},
}: CustomFieldInputsProps) {
  if (fields.length === 0) {
    return null;
  }
  const set = (key: string, value: unknown) => onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `custom-${field.key}`;
        const value = draft[field.key];
        const error = errors[`custom.${field.key}`];
        const label = field.required ? `${field.label} *` : field.label;
        const wide = field.type === 'TEXTAREA' || field.type === 'MULTI_SELECT';
        let input;
        switch (field.type) {
          case 'SELECT':
            return (
              <SelectField
                key={field.key}
                id={id}
                label={label}
                options={offeredItems(field.options, stored[field.key])}
                value={typeof value === 'string' ? value : null}
                onValueChange={(next) => set(field.key, next)}
                emptyLabel="未填写"
                error={error}
              />
            );
          case 'MULTI_SELECT': {
            const picked = new Set(Array.isArray(value) ? (value as string[]) : []);
            input = (
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                {offeredItems(field.options, stored[field.key]).map((option) => (
                  <Label key={option.value} className="font-normal">
                    <Checkbox
                      checked={picked.has(option.value)}
                      onCheckedChange={(checked) => {
                        const next = new Set(picked);
                        if (checked) next.add(option.value);
                        else next.delete(option.value);
                        set(field.key, [...next]);
                      }}
                    />
                    {option.label}
                  </Label>
                ))}
              </div>
            );
            break;
          }
          case 'BOOLEAN':
            input = (
              <div className="flex h-9 items-center gap-2">
                <Switch
                  id={id}
                  checked={value === true}
                  onCheckedChange={(checked) => set(field.key, checked)}
                  aria-invalid={!!error}
                />
                <span className="text-sm text-muted-foreground">
                  {value === true ? '是' : '否'}
                </span>
              </div>
            );
            break;
          case 'TEXTAREA':
            input = (
              <Textarea
                id={id}
                rows={3}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.key, event.target.value)}
                aria-invalid={!!error}
              />
            );
            break;
          default:
            input = (
              <Input
                id={id}
                type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
                step={field.type === 'NUMBER' ? 'any' : undefined}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(field.key, event.target.value)}
                aria-invalid={!!error}
              />
            );
        }
        return (
          <div key={field.key} className={wide ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
            {field.type === 'MULTI_SELECT' ? (
              <p className="text-sm font-medium">{label}</p>
            ) : (
              <Label htmlFor={id}>{label}</Label>
            )}
            {input}
            <FieldError message={error} />
          </div>
        );
      })}
    </div>
  );
}

/** A custom value as text: option labels for selects, 是/否, numbers with separators. */
export function formatCustomValue(field: CustomField, value: unknown): string {
  if (isEmptyCustomValue(value)) {
    return '—';
  }
  switch (field.type) {
    case 'SELECT':
      return itemLabel(field.options, String(value));
    case 'MULTI_SELECT':
      return Array.isArray(value)
        ? value.map((item) => itemLabel(field.options, String(item))).join('、')
        : String(value);
    case 'BOOLEAN':
      return value === true ? '是' : '否';
    case 'NUMBER':
      return typeof value === 'number' ? value.toLocaleString(currentLocale()) : String(value);
    default:
      return String(value);
  }
}

/** The record's custom values as label and value pairs, for a detail page's list. */
export function CustomFieldList({
  fields,
  values,
}: {
  fields: readonly CustomField[];
  values: CustomValues;
}) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="contents">
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="break-words whitespace-pre-wrap">
            {formatCustomValue(field, values[field.key])}
          </dd>
        </div>
      ))}
    </>
  );
}
