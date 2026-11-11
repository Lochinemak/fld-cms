import type { Contact } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ContactFormDialog } from '@/components/crm/contact-form-dialog';
import { formatCustomValue } from '@/components/custom-fields';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { customFieldsQuery } from '@/lib/custom-fields';
import { TableMessage } from '@/components/table-message';
import { Badge } from '@/components/ui/badge';
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
import { contactsQuery, deleteContact, refreshCrm } from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  page: z.number().int().min(1).optional().catch(undefined),
  keyword: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/crm/contacts')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="crm:contact">
      <ContactsPage />
    </RequirePermission>
  ),
});

type DialogState = { kind: 'edit'; contact: Contact } | { kind: 'delete'; contact: Contact };

function ContactsPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const { data, error, isPending } = useQuery(contactsQuery({ page, keyword: search.keyword }));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canSeeCustomers = useCan('crm:customer');
  const canUpdate = useCan('crm:contact:update');
  const canDelete = useCan('crm:contact:delete');
  const hasActions = canUpdate || canDelete;
  // The custom fields the tenant shows in the list, after the built-in columns.
  const listed = (useQuery(customFieldsQuery('crm.contact')).data ?? []).filter(
    (field) => field.showInList,
  );
  const columns = (hasActions ? 6 : 5) + listed.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="联系人"
        description="列出你能看到的客户的联系人；添加联系人请到客户详情页。"
      />
      <div className="space-y-4">
        <SearchBox
          value={search.keyword}
          placeholder="搜索姓名、电话、邮箱或客户名称"
          onSearch={(keyword) => void navigate({ search: { keyword } })}
        />
        <ErrorAlert error={error} />
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>职务</TableHead>
                <TableHead>电话</TableHead>
                <TableHead>邮箱</TableHead>
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
                <TableMessage colSpan={columns}>没有找到联系人</TableMessage>
              ) : (
                data.items.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{contact.name}</span>
                        {contact.primary && <Badge variant="secondary">主联系人</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canSeeCustomers ? (
                        <Link
                          to="/crm/customers/$customerId"
                          params={{ customerId: contact.customer.id }}
                          className="hover:underline"
                        >
                          {contact.customer.name}
                        </Link>
                      ) : (
                        contact.customer.name
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.title ?? '—'}</TableCell>
                    <TableCell>{contact.phone ?? '—'}</TableCell>
                    <TableCell className="break-all">{contact.email ?? '—'}</TableCell>
                    {listed.map((field) => (
                      <TableCell key={field.key}>
                        {formatCustomValue(field, contact.custom[field.key])}
                      </TableCell>
                    ))}
                    {hasActions && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDialog({ kind: 'edit', contact })}
                            >
                              编辑
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setDialog({ kind: 'delete', contact })}
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
      {dialog?.kind === 'edit' && (
        <ContactFormDialog
          customerId={dialog.contact.customer.id}
          contact={dialog.contact}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`删除联系人「${dialog.contact.name}」？`}
          description="提到这位联系人的跟进记录会保留，只是不再关联到他。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteContact(dialog.contact.id);
            await refreshCrm(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
    </div>
  );
}
