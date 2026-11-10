import { createContactSchema, updateContactSchema, type Contact } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/text-field';
import { TextareaField } from '@/components/textarea-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { createContact, refreshCrm, updateContact } from '@/lib/crm';
import { parseForm, type FieldErrors } from '@/lib/form';

interface ContactFormDialogProps {
  /** The customer the contact belongs to. */
  customerId: string;
  /** The contact to edit; without one, the dialog adds a contact to the customer. */
  contact?: Contact;
  onClosed: () => void;
}

export function ContactFormDialog({ customerId, contact, onClosed }: ContactFormDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [primary, setPrimary] = useState(contact?.primary ?? false);
  const mutation = useMutation({
    mutationFn: (save: () => Promise<unknown>) => save(),
    onSuccess: async () => {
      await refreshCrm(queryClient);
      dialog.close();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      name: form.get('name'),
      title: form.get('title'),
      phone: form.get('phone'),
      email: form.get('email'),
      primary,
      remark: form.get('remark'),
    };
    if (contact) {
      const input = parseForm(updateContactSchema, values, setErrors);
      if (input) {
        mutation.mutate(() => updateContact(contact.id, input));
      }
    } else {
      const input = parseForm(createContactSchema, { ...values, customerId }, setErrors);
      if (input) {
        mutation.mutate(() => createContact(input));
      }
    }
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{contact ? '编辑联系人' : '添加联系人'}</DialogTitle>
            <DialogDescription>
              {contact ? `修改「${contact.name}」的资料。` : '填写联系人的姓名和联系方式。'}
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="name"
              label="姓名"
              defaultValue={contact?.name}
              error={errors.name}
              autoFocus
              required
            />
            <TextField
              name="title"
              label="职务"
              defaultValue={contact?.title ?? ''}
              error={errors.title}
            />
            <TextField
              name="phone"
              label="电话"
              type="tel"
              defaultValue={contact?.phone ?? ''}
              error={errors.phone}
            />
            <TextField
              name="email"
              label="邮箱"
              type="email"
              defaultValue={contact?.email ?? ''}
              error={errors.email}
            />
          </div>
          <div className="space-y-1">
            <Label className="font-normal">
              <Checkbox checked={primary} onCheckedChange={(checked) => setPrimary(checked)} />
              设为主联系人
            </Label>
            <p className="text-xs text-muted-foreground">
              一个客户只有一位主联系人，设了新的会取消原来的。
            </p>
          </div>
          <TextareaField
            name="remark"
            label="备注"
            rows={2}
            defaultValue={contact?.remark ?? ''}
            error={errors.remark}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
              取消
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
