import type { Opportunity } from '@fld/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { StageBadge } from '@/components/crm/crm-badges';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form-dialog';
import { TransferDialog } from '@/components/crm/transfer-dialog';
import { TableMessage } from '@/components/table-message';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import { deleteOpportunity, formatAmount, refreshCrm, transferOpportunity } from '@/lib/crm';

type DialogState =
  | { kind: 'edit'; opportunity: Opportunity }
  | { kind: 'transfer'; opportunity: Opportunity }
  | { kind: 'delete'; opportunity: Opportunity };

interface OpportunityTableProps {
  /** Undefined while loading. */
  items: readonly Opportunity[] | undefined;
  /** Adds each opportunity's customer, for a list across customers. */
  showCustomer?: boolean;
  emptyText: string;
}

/** Opportunities with the actions the user may take on each. */
export function OpportunityTable({
  items,
  showCustomer = false,
  emptyText,
}: OpportunityTableProps) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canSeeCustomers = useCan('crm:customer');
  const canUpdate = useCan('crm:opportunity:update');
  const canTransfer = useCan('crm:opportunity:transfer');
  const canDelete = useCan('crm:opportunity:delete');
  const hasActions = canUpdate || canTransfer || canDelete;
  const columns = 5 + (showCustomer ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>商机</TableHead>
            {showCustomer && <TableHead>客户</TableHead>}
            <TableHead className="text-right">金额（元）</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>预计成交</TableHead>
            <TableHead>负责人</TableHead>
            {hasActions && <TableHead className="w-0" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!items ? (
            <TableMessage colSpan={columns}>加载中…</TableMessage>
          ) : items.length === 0 ? (
            <TableMessage colSpan={columns}>{emptyText}</TableMessage>
          ) : (
            items.map((opportunity) => (
              <TableRow key={opportunity.id}>
                <TableCell className="font-medium">{opportunity.name}</TableCell>
                {showCustomer && (
                  <TableCell>
                    {canSeeCustomers ? (
                      <Link
                        to="/crm/customers/$customerId"
                        params={{ customerId: opportunity.customer.id }}
                        className="hover:underline"
                      >
                        {opportunity.customer.name}
                      </Link>
                    ) : (
                      opportunity.customer.name
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {formatAmount(opportunity.amount)}
                </TableCell>
                <TableCell>
                  <StageBadge stage={opportunity.stage} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {opportunity.expectedCloseDate ?? '—'}
                </TableCell>
                <TableCell>
                  <div>{opportunity.owner.displayName}</div>
                  {opportunity.dept && (
                    <div className="text-xs text-muted-foreground">{opportunity.dept.name}</div>
                  )}
                </TableCell>
                {hasActions && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'edit', opportunity })}
                        >
                          编辑
                        </Button>
                      )}
                      {canTransfer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ kind: 'transfer', opportunity })}
                        >
                          转移
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDialog({ kind: 'delete', opportunity })}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {dialog?.kind === 'edit' && (
        <OpportunityFormDialog
          customerId={dialog.opportunity.customer.id}
          opportunity={dialog.opportunity}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog
          subject={`商机「${dialog.opportunity.name}」`}
          ownerId={dialog.opportunity.owner.id}
          transfer={(ownerId) => transferOpportunity(dialog.opportunity.id, ownerId)}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`删除商机「${dialog.opportunity.name}」？`}
          description="关联到它的跟进记录会保留，只是不再关联商机。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteOpportunity(dialog.opportunity.id);
            await refreshCrm(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
    </>
  );
}
