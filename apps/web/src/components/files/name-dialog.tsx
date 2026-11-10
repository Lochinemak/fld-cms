import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FocusEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { refreshFiles } from '@/lib/files';

interface NameDialogProps {
  title: string;
  description: string;
  label: string;
  /** The current name, when renaming. */
  name?: string;
  /** Selects the name without its extension, so that typing keeps the file's type. */
  keepExtension?: boolean;
  schema: z.ZodType<string>;
  /** If it fails, the dialog stays open and shows why. */
  save: (name: string) => Promise<unknown>;
  onClosed: () => void;
}

/** Names a new folder, or renames a file or folder. */
export function NameDialog({
  title,
  description,
  label,
  name = '',
  keepExtension = false,
  schema,
  save,
  onClosed,
}: NameDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [error, setError] = useState<string>();
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: async () => {
      await refreshFiles(queryClient);
      dialog.close();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = schema.safeParse(new FormData(event.currentTarget).get('name'));
    setError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    if (!parsed.success) {
      return;
    }
    if (parsed.data === name) {
      dialog.close();
    } else {
      mutation.mutate(parsed.data);
    }
  }

  function selectName(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, keepExtension && dot > 0 ? dot : input.value.length);
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <TextField
            name="name"
            label={label}
            defaultValue={name}
            error={error}
            autoFocus
            required
            autoComplete="off"
            onFocus={selectName}
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
