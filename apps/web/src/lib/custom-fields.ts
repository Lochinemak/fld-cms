import {
  customFieldSchema,
  dictionaryItemSchema,
  dictionarySchema,
  type BuiltinDictionaryCode,
  type CreateCustomFieldInput,
  type CreateDictionaryInput,
  type CreateDictionaryItemInput,
  type CustomFieldEntity,
  type DictionaryItem,
  type UpdateCustomFieldInput,
  type UpdateDictionaryInput,
  type UpdateDictionaryItemInput,
} from '@fld/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from './api';

/** A model's custom fields with their options, for its forms, lists and detail pages. */
export const customFieldsQuery = (entity: CustomFieldEntity) =>
  queryOptions({
    queryKey: ['custom-fields', entity],
    queryFn: () =>
      api(`/custom-fields?entity=${encodeURIComponent(entity)}`, {
        schema: customFieldSchema.array(),
      }),
    staleTime: 5 * 60_000,
  });

export const dictionariesQuery = queryOptions({
  queryKey: ['dictionaries'],
  queryFn: () => api('/dictionaries', { schema: dictionarySchema.array() }),
});

/** A built-in dictionary's items, such as the customer sources. */
export const builtinItemsQuery = (code: BuiltinDictionaryCode) =>
  queryOptions({
    queryKey: ['dictionaries', 'builtin', code],
    queryFn: () =>
      api(`/dictionaries/builtin/${code}/items`, { schema: dictionaryItemSchema.array() }),
    staleTime: 5 * 60_000,
  });

/** What a stored value shows as: the label of its item, or the value itself if it has none. */
export function itemLabel(items: readonly DictionaryItem[] | undefined, value: string): string {
  return items?.find((item) => item.value === value)?.label ?? value;
}

/** The items to offer: the enabled ones, and the record's own even if disabled since. */
export function offeredItems(items: readonly DictionaryItem[] | undefined, current: unknown) {
  const kept = new Set(Array.isArray(current) ? current : [current]);
  return (items ?? [])
    .filter((item) => item.enabled || kept.has(item.value))
    .map((item) => ({ value: item.value, label: item.label }));
}

export const createDictionary = (input: CreateDictionaryInput) =>
  api('/dictionaries', { method: 'POST', json: input, schema: dictionarySchema });

export const updateDictionary = (id: string, input: UpdateDictionaryInput) =>
  api(`/dictionaries/${id}`, { method: 'PATCH', json: input, schema: dictionarySchema });

export const deleteDictionary = (id: string) => api(`/dictionaries/${id}`, { method: 'DELETE' });

export const addDictionaryItem = (id: string, input: CreateDictionaryItemInput) =>
  api(`/dictionaries/${id}/items`, { method: 'POST', json: input, schema: dictionarySchema });

export const updateDictionaryItem = (
  id: string,
  itemId: string,
  input: UpdateDictionaryItemInput,
) =>
  api(`/dictionaries/${id}/items/${itemId}`, {
    method: 'PATCH',
    json: input,
    schema: dictionarySchema,
  });

export const createCustomField = (input: CreateCustomFieldInput) =>
  api('/custom-fields', { method: 'POST', json: input, schema: customFieldSchema });

export const updateCustomField = (id: string, input: UpdateCustomFieldInput) =>
  api(`/custom-fields/${id}`, { method: 'PATCH', json: input, schema: customFieldSchema });

export const deleteCustomField = (id: string) => api(`/custom-fields/${id}`, { method: 'DELETE' });

/** Refetches after a change: fields show their dictionaries' items, and dictionaries their fields. */
export function refreshCustomFields(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
    queryClient.invalidateQueries({ queryKey: ['dictionaries'] }),
  ]);
}
