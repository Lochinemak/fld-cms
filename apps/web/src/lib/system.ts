import {
  createMemberResultSchema,
  createTenantResultSchema,
  departmentSchema,
  memberSchema,
  pageSchema,
  resetMemberPasswordResultSchema,
  roleSchema,
  tenantPageSchema,
  type CreateDepartmentInput,
  type CreateMemberInput,
  type CreateRoleInput,
  type CreateTenantInput,
  type DataScope,
  type MemberStatus,
  type UpdateDepartmentInput,
  type UpdateMemberInput,
  type UpdateRoleInput,
  type UpdateTenantInput,
} from '@fld/shared';
import { keepPreviousData, queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { api } from './api';
import { meQuery } from './auth';
import { buildDeptTree, flattenDeptTree } from './dept-tree';

export const PAGE_SIZE = 20;

export const STATUS_LABELS: Record<MemberStatus, string> = { ACTIVE: '启用', DISABLED: '停用' };

export const DATA_SCOPES: Record<DataScope, { label: string; description: string }> = {
  ALL: { label: '全部数据', description: '本租户的全部数据' },
  DEPT_AND_CHILDREN: { label: '本部门及下级', description: '成员所在部门及其下级部门的数据' },
  DEPT: { label: '仅本部门', description: '成员所在部门的数据，不含下级部门' },
  SELF: { label: '仅本人', description: '只有成员本人的数据' },
  CUSTOM: { label: '自定义部门', description: '只有勾选的部门的数据' },
};

export interface TenantListParams {
  page: number;
  keyword?: string;
}

export interface MemberListParams extends TenantListParams {
  /** Members of the department and of every department below it. */
  deptId?: string;
  status?: MemberStatus;
}

const memberPageSchema = pageSchema(memberSchema);

/** A list endpoint's path with one page of the given filters; empty filters are left out. */
export function listPath(path: string, params: object): string {
  const search = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  return `${path}?${search}`;
}

export const tenantsQuery = (params: TenantListParams) =>
  queryOptions({
    queryKey: ['system', 'tenants', params],
    queryFn: () => api(listPath('/system/tenants', params), { schema: tenantPageSchema }),
    placeholderData: keepPreviousData,
  });

export const membersQuery = (params: MemberListParams) =>
  queryOptions({
    queryKey: ['system', 'members', params],
    queryFn: () => api(listPath('/system/members', params), { schema: memberPageSchema }),
    placeholderData: keepPreviousData,
  });

export const deptsQuery = queryOptions({
  queryKey: ['system', 'depts'],
  queryFn: () => api('/system/depts', { schema: z.array(departmentSchema) }),
});

export const rolesQuery = queryOptions({
  queryKey: ['system', 'roles'],
  queryFn: () => api('/system/roles', { schema: z.array(roleSchema) }),
});

/** The departments as a tree, and flattened parents first for indented lists. */
export function useDeptTree() {
  const { data, error, isPending } = useQuery(deptsQuery);
  const tree = useMemo(() => {
    const roots = buildDeptTree(data ?? []);
    return { roots, nodes: flattenDeptTree(roots) };
  }, [data]);
  return { ...tree, error, isPending };
}

export const createTenant = (input: CreateTenantInput) =>
  api('/system/tenants', { method: 'POST', json: input, schema: createTenantResultSchema });

export const updateTenant = (id: string, input: UpdateTenantInput) =>
  api(`/system/tenants/${id}`, { method: 'PATCH', json: input });

export const createDept = (input: CreateDepartmentInput) =>
  api('/system/depts', { method: 'POST', json: input });

export const updateDept = (id: string, input: UpdateDepartmentInput) =>
  api(`/system/depts/${id}`, { method: 'PATCH', json: input });

export const deleteDept = (id: string) => api(`/system/depts/${id}`, { method: 'DELETE' });

export const createRole = (input: CreateRoleInput) =>
  api('/system/roles', { method: 'POST', json: input });

export const updateRole = (id: string, input: UpdateRoleInput) =>
  api(`/system/roles/${id}`, { method: 'PUT', json: input });

export const deleteRole = (id: string) => api(`/system/roles/${id}`, { method: 'DELETE' });

export const createMember = (input: CreateMemberInput) =>
  api('/system/members', { method: 'POST', json: input, schema: createMemberResultSchema });

export const updateMember = (id: string, input: UpdateMemberInput) =>
  api(`/system/members/${id}`, { method: 'PATCH', json: input });

export const removeMember = (id: string) => api(`/system/members/${id}`, { method: 'DELETE' });

export const resetMemberPassword = (id: string) =>
  api(`/system/members/${id}/reset-password`, {
    method: 'POST',
    schema: resetMemberPasswordResultSchema,
  });

/**
 * Refetches after a change. The system pages show one another's data (members per department
 * and role), and a role change may change the user's own permissions.
 */
export function refreshSystem(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['system'] }),
    queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  ]);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN');
}
