import type { Attachment } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Library, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FileIcon } from '@/components/files/file-icon';
import { FilePickerDialog } from '@/components/files/file-picker-dialog';
import { UploadList, useUploads } from '@/components/files/upload-queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/lib/auth';
import { formatDateTime, refreshCrm } from '@/lib/crm';
import {
  attachFiles,
  attachmentContentUrl,
  attachmentsQuery,
  detachFile,
  formatSize,
  refreshFiles,
  uploadPath,
} from '@/lib/files';

type DialogState = { kind: 'pick' } | { kind: 'detach'; attachment: Attachment };

/**
 * The files attached to the customer on its page. Whoever sees the customer may open them, even
 * files outside their own data scope.
 */
export function CustomerAttachments({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery(attachmentsQuery(customerId));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const picker = useRef<HTMLInputElement>(null);
  const canUpdate = useCan('crm:customer:update');
  const canBrowse = useCan('file:library');
  const canUpload = useCan('file:library:upload');
  const refresh = () => Promise.all([refreshCrm(queryClient), refreshFiles(queryClient)]);
  const uploads = useUploads(refresh);

  function uploadPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    uploads.add(
      files.map((file) => ({
        file,
        path: uploadPath(null),
        afterUpload: (uploaded) => attachFiles(customerId, [uploaded.id]),
      })),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>附件</CardTitle>
        {canUpdate && (canBrowse || canUpload) && (
          <CardAction className="flex gap-2">
            {canBrowse && (
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'pick' })}>
                <Library />
                从文件库选
              </Button>
            )}
            {canUpload && (
              <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
                <Upload />
                上传
              </Button>
            )}
            <input ref={picker} type="file" multiple hidden onChange={uploadPicked} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有附件。</p>
        ) : (
          <ul className="divide-y">
            {data.map((attachment) => (
              <li
                key={attachment.file.id}
                className="flex items-start gap-2 py-3 text-sm first:pt-0 last:pb-0"
              >
                <FileIcon
                  mimeType={attachment.file.mimeType}
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <a
                    href={attachmentContentUrl(customerId, attachment.file.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium hover:underline"
                  >
                    {attachment.file.name}
                  </a>
                  <div className="text-xs text-muted-foreground">
                    {formatSize(attachment.file.size)} · {attachment.attachedBy.displayName} 添加于{' '}
                    {formatDateTime(attachment.attachedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <a
                    href={attachmentContentUrl(customerId, attachment.file.id, true)}
                    aria-label={`下载 ${attachment.file.name}`}
                    className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                  >
                    <Download />
                  </a>
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDialog({ kind: 'detach', attachment })}
                    >
                      移除
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <UploadList tasks={uploads.tasks} onClear={uploads.clearFinished} />
        {uploads.tasks.length > 0 && (
          <p className="text-xs text-muted-foreground">上传的文件放在你的文件库最外层。</p>
        )}
      </CardContent>
      {dialog?.kind === 'pick' && (
        <FilePickerDialog
          title="从文件库选附件"
          description="勾选要挂到这个客户上的文件。能看到这个客户的人都能打开它们。"
          pickedIds={new Set(data?.map(({ file }) => file.id))}
          pick={async (fileIds) => {
            await attachFiles(customerId, fileIds);
            await refresh();
          }}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'detach' && (
        <ConfirmDialog
          title={`移除附件「${dialog.attachment.file.name}」？`}
          description="只是不再挂在这个客户上，文件仍留在文件库里。"
          confirmLabel="移除"
          destructive
          action={async () => {
            await detachFile(customerId, dialog.attachment.file.id);
            await refresh();
          }}
          onClosed={closeDialog}
        />
      )}
    </Card>
  );
}
