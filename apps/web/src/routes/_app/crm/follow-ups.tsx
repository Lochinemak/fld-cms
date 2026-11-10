import type { FollowUp } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import {
  FOLLOW_UP_METHOD_LABELS,
  deleteFollowUp,
  followUpsQuery,
  formatDateTime,
  refreshCrm,
} from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/crm/follow-ups')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="crm:follow-up">
      <FollowUpsPage />
    </RequirePermission>
  ),
});

function FollowUpsPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(
    followUpsQuery({ page, keyword: search.keyword, mine: search.mine }),
  );
  const [removing, setRemoving] = useState<FollowUp | null>(null);
  const canSeeCustomers = useCan('crm:customer');
  const canDelete = useCan('crm:follow-up:delete');
  const columns = canDelete ? 7 : 6;

  // A new filter starts again from the first page.
  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="跟进记录"
        description="列出你能看到的客户的跟进记录，最新的在前；写跟进请到客户详情页。"
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchBox
            value={search.keyword}
            placeholder="搜索跟进内容或客户名称"
            onSearch={(keyword) => filter({ keyword })}
          />
          <Label className="font-normal">
            <Checkbox
              checked={search.mine ?? false}
              onCheckedChange={(checked) => filter({ mine: checked || undefined })}
            />
            只看我写的
          </Label>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>跟进时间</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>方式</TableHead>
                <TableHead>内容</TableHead>
                <TableHead>记录人</TableHead>
                <TableHead>计划下次跟进</TableHead>
                {canDelete && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableMessage colSpan={columns}>加载中…</TableMessage>
              ) : !data?.items.length ? (
                <TableMessage colSpan={columns}>没有找到跟进记录</TableMessage>
              ) : (
                data.items.map((followUp) => (
                  <TableRow key={followUp.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(followUp.followedAt)}
                    </TableCell>
                    <TableCell>
                      {canSeeCustomers ? (
                        <Link
                          to="/crm/customers/$customerId"
                          params={{ customerId: followUp.customer.id }}
                          className="hover:underline"
                        >
                          {followUp.customer.name}
                        </Link>
                      ) : (
                        followUp.customer.name
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{FOLLOW_UP_METHOD_LABELS[followUp.method]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <p className="line-clamp-2">{followUp.content}</p>
                      {(followUp.contact ?? followUp.opportunity) && (
                        <p className="text-xs text-muted-foreground">
                          {[
                            followUp.contact && `联系人 ${followUp.contact.name}`,
                            followUp.opportunity && `商机 ${followUp.opportunity.name}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{followUp.author.displayName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {followUp.nextAt ? formatDateTime(followUp.nextAt) : '—'}
                    </TableCell>
                    {canDelete && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRemoving(followUp)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          onPageChange={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
        />
      </div>
      {removing && (
        <ConfirmDialog
          title="删除这条跟进记录？"
          description="删除后，客户的最近跟进和下次跟进时间按剩下最新的一条重新计算。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteFollowUp(removing.id);
            await refreshCrm(queryClient);
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
