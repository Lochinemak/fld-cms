import type { Contact } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ContactFormDialog } from '@/components/crm/contact-form-dialog';
import { ErrorAlert } from '@/components/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/lib/auth';
import { contactsQuery, deleteContact, refreshCrm } from '@/lib/crm';

type DialogState =
  { kind: 'create' } | { kind: 'edit'; contact: Contact } | { kind: 'delete'; contact: Contact };

/** The customer's contacts on its page, the primary one first. */
export function CustomerContacts({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(contactsQuery({ page: 1, customerId }));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const canUpdate = useCan('crm:contact:update');
  const canDelete = useCan('crm:contact:delete');

  return (
    <Card>
      <CardHeader>
        <CardTitle>联系人</CardTitle>
        <CardAction>
          <Can code="crm:contact:create">
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              添加
            </Button>
          </Can>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorAlert error={error} />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有联系人。</p>
        ) : (
          <ul className="divide-y">
            {data.items.map((contact) => (
              <li
                key={contact.id}
                className="flex items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{contact.name}</span>
                    {contact.primary && <Badge variant="secondary">主联系人</Badge>}
                    {contact.title && (
                      <span className="text-muted-foreground">{contact.title}</span>
                    )}
                  </div>
                  {(contact.phone ?? contact.email) && (
                    <div className="break-all text-muted-foreground">
                      {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {contact.remark && (
                    <p className="whitespace-pre-wrap text-muted-foreground">{contact.remark}</p>
                  )}
                </div>
                {(canUpdate || canDelete) && (
                  <div className="flex shrink-0 gap-1">
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
                )}
              </li>
            ))}
          </ul>
        )}
        {data && data.total > data.items.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            共 {data.total} 位，这里只列出前 {data.items.length}{' '}
            位；其余的在「联系人」页搜客户名称。
          </p>
        )}
      </CardContent>
      {dialog?.kind === 'create' && (
        <ContactFormDialog customerId={customerId} onClosed={closeDialog} />
      )}
      {dialog?.kind === 'edit' && (
        <ContactFormDialog
          customerId={customerId}
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
    </Card>
  );
}
