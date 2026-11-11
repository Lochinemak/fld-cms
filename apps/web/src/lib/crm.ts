import {
  contactSchema,
  customerSchema,
  followUpSchema,
  opportunityPageSchema,
  ownerOptionSchema,
  pageSchema,
  type CreateContactInput,
  type CreateCustomerInput,
  type CreateFollowUpInput,
  type CreateOpportunityInput,
  type CustomerLevel,
  type CustomerStatus,
  type FollowUpMethod,
  type OpportunityStage,
  type UpdateContactInput,
  type UpdateCustomerInput,
  type UpdateOpportunityInput,
} from '@fld/shared';
import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';
import { listPath } from './system';

// The labels live in @fld/shared: spreadsheets the API writes use them too.
export { CUSTOMER_LEVEL_LABELS, CUSTOMER_STATUS_LABELS } from '@fld/shared';

export const FOLLOW_UP_METHOD_LABELS: Record<FollowUpMethod, string> = {
  CALL: '电话',
  VISIT: '拜访',
  WECHAT: '微信',
  EMAIL: '邮件',
  MEETING: '会议',
  OTHER: '其他',
};

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  QUALIFY: '初步接洽',
  NEEDS: '需求确认',
  PROPOSAL: '方案报价',
  NEGOTIATION: '商务谈判',
  WON: '赢单',
  LOST: '输单',
};

export interface CustomerListParams {
  page: number;
  keyword?: string;
  status?: CustomerStatus;
  level?: CustomerLevel;
  /** Only the customers the user owns. */
  mine?: boolean;
  /** Only the customers whose next follow-up is due by then. */
  dueBy?: string;
}

export interface ContactListParams {
  page: number;
  keyword?: string;
  customerId?: string;
}

export interface FollowUpListParams {
  page: number;
  keyword?: string;
  customerId?: string;
  /** Only the follow-ups the user wrote. */
  mine?: boolean;
}

export interface OpportunityListParams {
  page: number;
  keyword?: string;
  stage?: OpportunityStage;
  customerId?: string;
  /** Only the opportunities the user owns. */
  mine?: boolean;
}

const customerPageSchema = pageSchema(customerSchema);
const contactPageSchema = pageSchema(contactSchema);
const followUpPageSchema = pageSchema(followUpSchema);

export const customersQuery = (params: CustomerListParams) =>
  queryOptions({
    queryKey: ['crm', 'customers', params],
    queryFn: () => api(listPath('/crm/customers', params), { schema: customerPageSchema }),
    placeholderData: keepPreviousData,
  });

export const customerQuery = (id: string) =>
  queryOptions({
    queryKey: ['crm', 'customer', id],
    queryFn: () => api(`/crm/customers/${id}`, { schema: customerSchema }),
  });

export const contactsQuery = (params: ContactListParams) =>
  queryOptions({
    queryKey: ['crm', 'contacts', params],
    queryFn: () => api(listPath('/crm/contacts', params), { schema: contactPageSchema }),
    placeholderData: keepPreviousData,
  });

export const followUpsQuery = (params: FollowUpListParams) =>
  queryOptions({
    queryKey: ['crm', 'follow-ups', params],
    queryFn: () => api(listPath('/crm/follow-ups', params), { schema: followUpPageSchema }),
    placeholderData: keepPreviousData,
  });

export const opportunitiesQuery = (params: OpportunityListParams) =>
  queryOptions({
    queryKey: ['crm', 'opportunities', params],
    queryFn: () => api(listPath('/crm/opportunities', params), { schema: opportunityPageSchema }),
    placeholderData: keepPreviousData,
  });

/** Members the user may hand customers and opportunities to. */
export const ownersQuery = queryOptions({
  queryKey: ['crm', 'owners'],
  queryFn: () => api('/crm/owners', { schema: z.array(ownerOptionSchema) }),
  staleTime: 5 * 60_000,
});

export const createCustomer = (input: CreateCustomerInput) =>
  api('/crm/customers', { method: 'POST', json: input, schema: customerSchema });

export const updateCustomer = (id: string, input: UpdateCustomerInput) =>
  api(`/crm/customers/${id}`, { method: 'PATCH', json: input });

export const transferCustomer = (id: string, ownerId: string) =>
  api(`/crm/customers/${id}/transfer`, { method: 'POST', json: { ownerId } });

export const deleteCustomer = (id: string) => api(`/crm/customers/${id}`, { method: 'DELETE' });

export const createContact = (input: CreateContactInput) =>
  api('/crm/contacts', { method: 'POST', json: input });

export const updateContact = (id: string, input: UpdateContactInput) =>
  api(`/crm/contacts/${id}`, { method: 'PATCH', json: input });

export const deleteContact = (id: string) => api(`/crm/contacts/${id}`, { method: 'DELETE' });

export const createFollowUp = (input: CreateFollowUpInput) =>
  api('/crm/follow-ups', { method: 'POST', json: input });

export const deleteFollowUp = (id: string) => api(`/crm/follow-ups/${id}`, { method: 'DELETE' });

export const createOpportunity = (input: CreateOpportunityInput) =>
  api('/crm/opportunities', { method: 'POST', json: input });

export const updateOpportunity = (id: string, input: UpdateOpportunityInput) =>
  api(`/crm/opportunities/${id}`, { method: 'PATCH', json: input });

export const transferOpportunity = (id: string, ownerId: string) =>
  api(`/crm/opportunities/${id}/transfer`, { method: 'POST', json: { ownerId } });

export const deleteOpportunity = (id: string) =>
  api(`/crm/opportunities/${id}`, { method: 'DELETE' });

/**
 * Refetches after a change. The CRM pages show one another's data: a follow-up moves its
 * customer's follow-up times, and winning an opportunity wins its customer.
 */
export function refreshCrm(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['crm'] });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

/** A decimal amount such as "1234567.5" as "1,234,567.50", without going through a float. */
export function formatAmount(amount: string): string {
  const [integer = '0', fraction = ''] = amount.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

/** A time as a `datetime-local` input shows it, in the browser's time zone. */
export function toLocalInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** A `datetime-local` input's value as an ISO time, or undefined when it is empty. */
export function fromLocalInput(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value !== '' ? new Date(value).toISOString() : undefined;
}

/** The end of today in the browser's time zone: customers due by then need a follow-up today. */
export function endOfToday(): string {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}
