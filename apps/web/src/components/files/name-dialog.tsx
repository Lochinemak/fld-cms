import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FocusEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { TextField } from '@/components/text-field';
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
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={title}
      description={description}
      error={mutation.error}
      pending={mutation.isPending}
      onSubmit={submit}
    >
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
    </FormDialog>
  );
}
