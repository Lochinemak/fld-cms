import { IMPORT_MAX_ROWS, SPREADSHEET_ENTITIES, type SpreadsheetEntity } from '@fld/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { FormDialog } from '@/components/form-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { formatSize } from '@/lib/files';
import {
  createExport,
  createImport,
  refreshSpreadsheets,
  spreadsheetTemplateUrl,
} from '@/lib/spreadsheets';

const STARTED_TEXT = {
  export: '已开始导出，完成后会在右上角通知你，也可以在「导入导出」页面下载。',
  import: '已开始导入，完成后会在右上角通知你，也可以在「导入导出」页面查看结果。',
} as const;

/** Says an export or an import has started, and where to find it. */
function StartedDialog({
  kind,
  error,
  onClosed,
}: {
  kind: 'export' | 'import';
  /** Why it didn't start, if it didn't. */
  error?: { message: string } | null;
  onClosed: () => void;
}) {
  const dialog = useMountedDialog(onClosed);
  const action = kind === 'export' ? '导出' : '导入';
  return (
    <Dialog {...dialog.rootProps()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{error ? `没能开始${action}` : `已开始${action}`}</DialogTitle>
          {!error && <DialogDescription>{STARTED_TEXT[kind]}</DialogDescription>}
        </DialogHeader>
        <ErrorAlert error={error} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
          {!error && (
            <Link to="/spreadsheets" className={buttonVariants()} onClick={dialog.close}>
              去看看
            </Link>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ExportButtonProps {
  entity: SpreadsheetEntity;
  /** The list page's filters, without its page. */
  query: Record<string, unknown>;
}

/** Exports the model's rows the list page's filters pick, in the background. */
export function ExportButton({ entity, query }: ExportButtonProps) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const mutation = useMutation({
    mutationFn: () => createExport(entity, query),
    onSuccess: () => refreshSpreadsheets(queryClient),
    onSettled: () => setShown(true),
  });
  return (
    <>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        <Download />
        {mutation.isPending ? '导出中…' : '导出'}
      </Button>
      {shown && (
        <StartedDialog
          kind="export"
          error={mutation.error}
          onClosed={() => {
            setShown(false);
            mutation.reset();
          }}
        />
      )}
    </>
  );
}

/** Imports a filled-in template of the model, in the background. */
export function ImportButton({ entity }: { entity: SpreadsheetEntity }) {
  const [step, setStep] = useState<'form' | 'started' | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => setStep('form')}>
        <Upload />
        导入
      </Button>
      {step === 'form' && (
        <ImportDialog entity={entity} onClosed={(started) => setStep(started ? 'started' : null)} />
      )}
      {step === 'started' && <StartedDialog kind="import" onClosed={() => setStep(null)} />}
    </>
  );
}

function ImportDialog({
  entity,
  onClosed,
}: {
  entity: SpreadsheetEntity;
  /** Once the dialog has closed, saying whether the import started. */
  onClosed: (started: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const started = useRef(false);
  const dialog = useMountedDialog(() => onClosed(started.current));
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string>();
  const name = SPREADSHEET_ENTITIES[entity].name;
  const mutation = useMutation({
    mutationFn: (picked: File) => createImport(entity, picked, setSent),
    onSuccess: async () => {
      started.current = true;
      dialog.close();
      await refreshSpreadsheets(queryClient);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError('请选择要导入的文件');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('只能导入 .xlsx 文件');
      return;
    }
    setError(undefined);
    setSent(0);
    mutation.mutate(file);
  }

  const percent = file && file.size > 0 ? Math.min(100, Math.round((sent / file.size) * 100)) : 0;
  const failure = error ? { message: error } : mutation.error;

  return (
    <FormDialog
      {...dialog.rootProps(mutation.isPending)}
      title={`导入${name}`}
      description="按模板填好后上传，导入在后台进行。"
      error={failure}
      pending={mutation.isPending}
      submitLabel="开始导入"
      pendingLabel={`上传中 ${percent}%`}
      onSubmit={submit}
    >
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          <a href={spreadsheetTemplateUrl(entity)} className="text-primary hover:underline">
            下载模板
          </a>
        </li>
        <li>按模板填写，一次最多 {IMPORT_MAX_ROWS} 行。</li>
        <li>选择填好的 .xlsx 文件，点「开始导入」。</li>
      </ol>
      <div className="grid gap-2">
        <Label htmlFor="spreadsheet-import-file">文件</Label>
        <Input
          id="spreadsheet-import-file"
          type="file"
          accept=".xlsx"
          disabled={mutation.isPending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(undefined);
          }}
        />
        {file && <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>}
      </div>
      {mutation.isPending && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        只要有一行不对，整个文件都不会导入，会列出有问题的行。
      </p>
    </FormDialog>
  );
}
