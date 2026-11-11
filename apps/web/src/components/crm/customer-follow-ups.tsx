import type { FollowUp } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FollowUpFormDialog } from '@/components/crm/follow-up-form-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { PaginationBar } from '@/components/pagination-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/lib/auth';
import {
  FOLLOW_UP_METHOD_LABELS,
  deleteFollowUp,
  followUpsQuery,
  formatDateTime,
  refreshCrm,
} from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';

type DialogState = { kind: 'create' } | { kind: 'delete'; followUp: FollowUp };

/** The customer's follow-ups on its page, the latest first. */
export function CustomerFollowUps({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, error } = useQuery(followUpsQuery({ page, customerId }));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canDelete = useCan('crm:follow-up:delete');

  return (
    <Card>
      <CardHeader>
        <CardTitle>跟进记录</CardTitle>
        <CardAction>
          <Can code="crm:follow-up:create">
            <Button size="sm" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              写跟进
            </Button>
          </Can>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <ErrorAlert error={error} />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有跟进记录。</p>
        ) : (
          <ol className="space-y-5">
            {data.items.map((followUp) => (
              <li key={followUp.id} className="border-l-2 pl-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Badge variant="outline">{FOLLOW_UP_METHOD_LABELS[followUp.method]}</Badge>
                  <span className="font-medium">{formatDateTime(followUp.followedAt)}</span>
                  <span className="text-muted-foreground">{followUp.author.displayName}</span>
                  {followUp.contact && (
                    <span className="text-muted-foreground">· 联系人 {followUp.contact.name}</span>
                  )}
                  {followUp.opportunity && (
                    <span className="text-muted-foreground">
                      · 商机 {followUp.opportunity.name}
                    </span>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive"
                      onClick={() => setDialog({ kind: 'delete', followUp })}
                    >
                      删除
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{followUp.content}</p>
                {followUp.nextAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    计划下次跟进：{formatDateTime(followUp.nextAt)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        {data && data.total > PAGE_SIZE && (
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </CardContent>
      {dialog?.kind === 'create' && (
        <FollowUpFormDialog customerId={customerId} onClosed={closeDialog} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="删除这条跟进记录？"
          description="删除后，客户的最近跟进和下次跟进时间按剩下最新的一条重新计算。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteFollowUp(dialog.followUp.id);
            await refreshCrm(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
    </Card>
  );
}
