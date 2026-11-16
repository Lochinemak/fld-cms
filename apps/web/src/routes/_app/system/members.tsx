import { memberStatusSchema } from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Can } from '@/components/can';
import { ErrorAlert } from '@/components/error-alert';
import { DeptFilter } from '@/components/members/dept-filter';
import { MemberDialogs, type DialogState } from '@/components/members/member-dialogs';
import { MemberRow } from '@/components/members/member-row';
import { StatusFilter } from '@/components/members/status-filter';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMe } from '@/lib/auth';
import { PAGE_SIZE, membersQuery, useDeptTree } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  deptId: z.string().optional().catch(undefined),
  status: memberStatusSchema.optional().catch(undefined),
});

export const Route = createFileRoute('/_app/system/members')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="system:member">
      <MembersPage />
    </RequirePermission>
  ),
});

function MembersPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { nodes } = useDeptTree();
  const { data, error, isPending } = useQuery(
    membersQuery({ page, keyword: search.keyword, deptId: search.deptId, status: search.status }),
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);

  // A new filter starts again from the first page.
  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="成员管理"
        description="只列出你的数据范围内的成员；选择部门时包括它的下级部门。"
        actions={
          <Can code="system:member:create">
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <UserPlus />
              添加成员
            </Button>
          </Can>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <DeptFilter nodes={nodes} value={search.deptId} onChange={(deptId) => filter({ deptId })} />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox
              value={search.keyword}
              placeholder="搜索用户名、姓名或邮箱"
              onSearch={(keyword) => filter({ keyword })}
            />
            <StatusFilter value={search.status} onChange={(status) => filter({ status })} />
          </div>
          <ErrorAlert error={error} />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending && <TableMessage colSpan={6}>加载中…</TableMessage>}
                {data?.items.length === 0 && <TableMessage colSpan={6}>没有找到成员</TableMessage>}
                {data?.items.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    self={member.userId === me.user.id}
                    onAction={setDialog}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {data && (
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPageChange={(next) =>
                void navigate({ search: (prev) => ({ ...prev, page: next }) })
              }
            />
          )}
        </div>
      </div>
      <MemberDialogs
        dialog={dialog}
        nodes={nodes}
        defaultDeptId={search.deptId ?? nodes[0]?.id ?? null}
        onClosed={closeDialog}
      />
    </div>
  );
}
