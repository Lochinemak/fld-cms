import type { Contact, ContactSort, CustomField } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ContactFormDialog } from '@/components/crm/contact-form-dialog';
import { formatCustomValue } from '@/components/custom-fields';
import { ColumnsMenu, DataTable } from '@/components/data-table';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { customFieldsQuery } from '@/lib/custom-fields';
import { ExportButton } from '@/components/spreadsheets/spreadsheet-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/auth';
import { contactsQuery, deleteContact, formatDateTime, refreshCrm } from '@/lib/crm';
import { PAGE_SIZE } from '@/lib/system';
import { useTableView, type DataColumn } from '@/lib/table-view';

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

/**
 * The list's columns: the built-in ones, then the tenant's custom fields. Each member picks
 * which to see; a custom field starts shown if the tenant ticked 在列表中显示.
 */
function contactColumns(
  customFields: readonly CustomField[],
  canSeeCustomers: boolean,
): DataColumn<Contact, ContactSort>[] {
  return [
    {
      id: 'name',
      header: '姓名',
      hideable: false,
      sortBy: 'name',
      cell: (contact) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{contact.name}</span>
          {contact.primary && <Badge variant="secondary">主联系人</Badge>}
        </div>
      ),
    },
    {
      id: 'customer',
      header: '客户',
      sortBy: 'customer',
      cell: (contact) =>
        canSeeCustomers ? (
          <Link
            to="/crm/customers/$customerId"
            params={{ customerId: contact.customer.id }}
            className="hover:underline"
          >
            {contact.customer.name}
          </Link>
        ) : (
          contact.customer.name
        ),
    },
    {
      id: 'title',
      header: '职务',
      sortBy: 'title',
      className: 'text-muted-foreground',
      cell: (contact) => contact.title ?? '—',
    },
    { id: 'phone', header: '电话', cell: (contact) => contact.phone ?? '—' },
    {
      id: 'email',
      header: '邮箱',
      className: 'break-all',
      cell: (contact) => contact.email ?? '—',
    },
    {
      id: 'createdAt',
      header: '创建时间',
      defaultHidden: true,
      sortBy: 'createdAt',
      className: 'text-muted-foreground',
      cell: (contact) => formatDateTime(contact.createdAt),
    },
    ...customFields.map((field): DataColumn<Contact, ContactSort> => ({
      id: `custom:${field.key}`,
      header: field.label,
      defaultHidden: !field.showInList,
      cell: (contact) => formatCustomValue(field, contact.custom[field.key]),
    })),
  ];
}

function ContactsPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canSeeCustomers = useCan('crm:customer');
  const canUpdate = useCan('crm:contact:update');
  const canDelete = useCan('crm:contact:delete');
  const hasActions = canUpdate || canDelete;
  const customFields = useQuery(customFieldsQuery('crm.contact')).data;
  const columns = useMemo(
    () => contactColumns(customFields ?? [], canSeeCustomers),
    [customFields, canSeeCustomers],
  );
  const view = useTableView(
    'crm.contact',
    columns,
    () => void navigate({ search: (prev) => ({ ...prev, page: undefined }) }),
  );
  const { data, error, isPending } = useQuery({
    ...contactsQuery({ page, keyword: search.keyword, ...view.sort }),
    enabled: view.ready,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="联系人"
        description="列出你能看到的客户的联系人；添加联系人请到客户详情页。"
        actions={
          <Can code="crm:contact:export">
            <ExportButton entity="crm.contact" query={{ keyword: search.keyword }} />
          </Can>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchBox
            value={search.keyword}
            placeholder="搜索姓名、电话、邮箱或客户名称"
            onSearch={(keyword) => void navigate({ search: { keyword } })}
          />
          <div className="ml-auto">
            <ColumnsMenu view={view} />
          </div>
        </div>
        <ErrorAlert error={error} />
        <DataTable
          view={view}
          rows={data?.items}
          rowKey={(contact) => contact.id}
          isPending={isPending}
          empty="没有找到联系人"
          actions={
            hasActions
              ? (contact) => (
                  <>
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
                  </>
                )
              : undefined
          }
        />
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
