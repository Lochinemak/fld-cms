import { customerLevelSchema, customerStatusSchema, type Customer } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Can } from '@/components/can';
import { formatCustomValue } from '@/components/custom-fields';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomerLevelBadge, CustomerStatusBadge } from '@/components/crm/crm-badges';
import { CustomerFormDialog } from '@/components/crm/customer-form-dialog';
import { NextFollowUp } from '@/components/crm/next-follow-up';
import { TransferDialog } from '@/components/crm/transfer-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { FilterSelect } from '@/components/filter-select';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
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
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_STATUS_LABELS,
  customersQuery,
  deleteCustomer,
  endOfToday,
  formatDateTime,
  refreshCrm,
  transferCustomer,
} from '@/lib/crm';
import { customFieldsQuery } from '@/lib/custom-fields';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
  status: customerStatusSchema.optional().catch(undefined),
  level: customerLevelSchema.optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
  /** Only the customers due a follow-up by the end of today, overdue ones included. */
  due: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/crm/customers/')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="crm:customer">
      <CustomersPage />
    </RequirePermission>
  ),
});

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; customer: Customer }
  | { kind: 'transfer'; customer: Customer }
  | { kind: 'delete'; customer: Customer };

const STATUS_OPTIONS = customerStatusSchema.options.map((value) => ({
  value,
  label: CUSTOMER_STATUS_LABELS[value],
}));
const LEVEL_OPTIONS = customerLevelSchema.options.map((value) => ({
  value,
  label: CUSTOMER_LEVEL_LABELS[value],
}));

function CustomersPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(
    customersQuery({
      page,
      keyword: search.keyword,
      status: search.status,
      level: search.level,
      mine: search.mine,
      dueBy: search.due ? endOfToday() : undefined,
    }),
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canUpdate = useCan('crm:customer:update');
  const canTransfer = useCan('crm:customer:transfer');
  const canDelete = useCan('crm:customer:delete');
  const hasActions = canUpdate || canTransfer || canDelete;
  // The custom fields the tenant shows in the list, after the built-in columns.
  const listed = (useQuery(customFieldsQuery('crm.customer')).data ?? []).filter(
    (field) => field.showInList,
  );
  const columns = (hasActions ? 7 : 6) + listed.length;

  // A new filter starts again from the first page.
  const filter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="客户"
        description="只列出你的数据范围内的客户。"
        actions={
          <Can code="crm:customer:create">
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              新建客户
            </Button>
          </Can>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchBox
            value={search.keyword}
            placeholder="搜索客户名称或电话"
            onSearch={(keyword) => filter({ keyword })}
          />
          <div className="flex gap-2">
            <FilterSelect
              label="按状态筛选"
              allLabel="全部状态"
              options={STATUS_OPTIONS}
              value={search.status}
              onValueChange={(status) => filter({ status })}
            />
            <FilterSelect
              label="按级别筛选"
              allLabel="全部级别"
              options={LEVEL_OPTIONS}
              value={search.level}
              onValueChange={(level) => filter({ level })}
            />
          </div>
          <div className="flex gap-4">
            <Label className="font-normal">
              <Checkbox
                checked={search.mine ?? false}
                onCheckedChange={(checked) => filter({ mine: checked || undefined })}
              />
              只看我负责的
            </Label>
            <Label className="font-normal">
              <Checkbox
                checked={search.due ?? false}
                onCheckedChange={(checked) => filter({ due: checked || undefined })}
              />
              今天要跟进
            </Label>
          </div>
        </div>
        <ErrorAlert error={error} />
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客户</TableHead>
                <TableHead>级别</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>最近跟进</TableHead>
                <TableHead>下次跟进</TableHead>
                {listed.map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                {hasActions && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableMessage colSpan={columns}>加载中…</TableMessage>
              ) : !data?.items.length ? (
                <TableMessage colSpan={columns}>没有找到客户</TableMessage>
              ) : (
                data.items.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link
                        to="/crm/customers/$customerId"
                        params={{ customerId: customer.id }}
                        className="font-medium hover:underline"
                      >
                        {customer.name}
                      </Link>
                      {customer.industry && (
                        <div className="text-xs text-muted-foreground">{customer.industry}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <CustomerLevelBadge level={customer.level} />
                    </TableCell>
                    <TableCell>
                      <CustomerStatusBadge status={customer.status} />
                    </TableCell>
                    <TableCell>
                      <div>{customer.owner.displayName}</div>
                      {customer.dept && (
                        <div className="text-xs text-muted-foreground">{customer.dept.name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.lastFollowUpAt ? formatDateTime(customer.lastFollowUpAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <NextFollowUp at={customer.nextFollowUpAt} />
                    </TableCell>
                    {listed.map((field) => (
                      <TableCell key={field.key}>
                        {formatCustomValue(field, customer.custom[field.key])}
                      </TableCell>
                    ))}
                    {hasActions && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDialog({ kind: 'edit', customer })}
                            >
                              编辑
                            </Button>
                          )}
                          {canTransfer && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDialog({ kind: 'transfer', customer })}
                            >
                              转移
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDialog({ kind: 'delete', customer })}
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
        </div>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          onPageChange={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
        />
      </div>
      {dialog?.kind === 'create' && <CustomerFormDialog onClosed={closeDialog} />}
      {dialog?.kind === 'edit' && (
        <CustomerFormDialog customer={dialog.customer} onClosed={closeDialog} />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog
          subject={`客户「${dialog.customer.name}」`}
          ownerId={dialog.customer.owner.id}
          transfer={(ownerId) => transferCustomer(dialog.customer.id, ownerId)}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`删除客户「${dialog.customer.name}」？`}
          description="联系人和跟进记录会一起删除，无法恢复；附件只是不再挂在客户上，文件仍留在文件库里。还有商机的客户不能删除。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteCustomer(dialog.customer.id);
            await refreshCrm(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
    </div>
  );
}
