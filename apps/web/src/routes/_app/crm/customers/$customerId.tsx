import type { Customer } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRightLeft, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomerLevelBadge, CustomerStatusBadge } from '@/components/crm/crm-badges';
import { CustomerAttachments } from '@/components/crm/customer-attachments';
import { CustomerContacts } from '@/components/crm/customer-contacts';
import { CustomerFollowUps } from '@/components/crm/customer-follow-ups';
import { CustomerFormDialog } from '@/components/crm/customer-form-dialog';
import { CustomerOpportunities } from '@/components/crm/customer-opportunities';
import { NextFollowUp } from '@/components/crm/next-follow-up';
import { TransferDialog } from '@/components/crm/transfer-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CUSTOMER_SOURCE_LABELS,
  customerQuery,
  deleteCustomer,
  formatDateTime,
  refreshCrm,
  transferCustomer,
} from '@/lib/crm';

export const Route = createFileRoute('/_app/crm/customers/$customerId')({
  component: () => (
    <RequirePermission code="crm:customer">
      <CustomerPage />
    </RequirePermission>
  ),
});

function CustomerPage() {
  const { customerId } = Route.useParams();
  const { data: customer, error } = useQuery(customerQuery(customerId));

  return (
    <div className="space-y-6">
      <Link
        to="/crm/customers"
        activeOptions={{ exact: true }}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ArrowLeft />
        客户列表
      </Link>
      {error ? (
        <ErrorAlert error={error} />
      ) : !customer ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <CustomerDetail customer={customer} />
      )}
    </div>
  );
}

type DialogState = 'edit' | 'transfer' | 'delete';

function CustomerDetail({ customer }: { customer: Customer }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <CustomerLevelBadge level={customer.level} />
            <CustomerStatusBadge status={customer.status} />
            负责人：{customer.owner.displayName}
          </span>
        }
        actions={
          <>
            <Can code="crm:customer:update">
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil />
                编辑
              </Button>
            </Can>
            <Can code="crm:customer:transfer">
              <Button variant="outline" onClick={() => setDialog('transfer')}>
                <ArrowRightLeft />
                转移
              </Button>
            </Can>
            <Can code="crm:customer:delete">
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setDialog('delete')}
              >
                <Trash2 />
                删除
              </Button>
            </Can>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <CustomerInfo customer={customer} />
          <Can code="crm:contact">
            <CustomerContacts customerId={customer.id} />
          </Can>
          <CustomerAttachments customerId={customer.id} />
        </div>
        <div className="space-y-6">
          <Can code="crm:follow-up">
            <CustomerFollowUps customerId={customer.id} />
          </Can>
          <Can code="crm:opportunity">
            <CustomerOpportunities customerId={customer.id} />
          </Can>
        </div>
      </div>
      {dialog === 'edit' && <CustomerFormDialog customer={customer} onClosed={closeDialog} />}
      {dialog === 'transfer' && (
        <TransferDialog
          subject={`客户「${customer.name}」`}
          ownerId={customer.owner.id}
          transfer={(ownerId) => transferCustomer(customer.id, ownerId)}
          onClosed={closeDialog}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`删除客户「${customer.name}」？`}
          description="联系人和跟进记录会一起删除，无法恢复；附件只是不再挂在客户上，文件仍留在文件库里。还有商机的客户不能删除。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteCustomer(customer.id);
            // Leave first, so that the refresh doesn't refetch the customer just deleted.
            await navigate({ to: '/crm/customers' });
            queryClient.removeQueries({ queryKey: customerQuery(customer.id).queryKey });
            await refreshCrm(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
    </>
  );
}

function CustomerInfo({ customer }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>基本信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <InfoRow label="负责人">{customer.owner.displayName}</InfoRow>
          <InfoRow label="部门">{customer.dept?.name ?? '—'}</InfoRow>
          <InfoRow label="来源">
            {customer.source ? CUSTOMER_SOURCE_LABELS[customer.source] : '—'}
          </InfoRow>
          <InfoRow label="行业">{customer.industry ?? '—'}</InfoRow>
          <InfoRow label="电话">{customer.phone ?? '—'}</InfoRow>
          <InfoRow label="地址">{customer.address ?? '—'}</InfoRow>
          <InfoRow label="最近跟进">
            {customer.lastFollowUpAt ? formatDateTime(customer.lastFollowUpAt) : '—'}
          </InfoRow>
          <InfoRow label="下次跟进">
            <NextFollowUp at={customer.nextFollowUpAt} />
          </InfoRow>
          <InfoRow label="创建">
            {customer.creator.displayName} · {formatDateTime(customer.createdAt)}
          </InfoRow>
        </dl>
        {customer.remark && (
          <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{customer.remark}</p>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
