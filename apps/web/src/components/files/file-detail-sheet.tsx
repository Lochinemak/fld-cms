import type { FileVersion, StoredFileDetail } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, Eye, Share2, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Can } from '@/components/can';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FileIcon } from '@/components/files/file-icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/crm';
import {
  canPreview,
  fileContentUrl,
  fileQuery,
  formatSize,
  refreshFiles,
  restoreVersion,
  versionContentUrl,
} from '@/lib/files';

interface FileDetailSheetProps {
  fileId: string;
  /** Picks the file's new version. */
  onReplace: (file: StoredFileDetail) => void;
  onShare: (file: StoredFileDetail) => void;
  onClosed: () => void;
}

/** A file's details at the side of the page: where it is used, and its versions. */
export function FileDetailSheet({ fileId, onReplace, onShare, onClosed }: FileDetailSheetProps) {
  const dialog = useMountedDialog(onClosed);
  const { data: file, error } = useQuery(fileQuery(fileId));

  return (
    <Sheet {...dialog.rootProps()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {error ? (
          <>
            <SheetHeader>
              <SheetTitle>文件详情</SheetTitle>
            </SheetHeader>
            <Alert variant="destructive" className="mx-4 w-auto">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          </>
        ) : !file ? (
          <SheetHeader>
            <SheetTitle>文件详情</SheetTitle>
            <SheetDescription>加载中…</SheetDescription>
          </SheetHeader>
        ) : (
          <FileDetail file={file} onReplace={onReplace} onShare={onShare} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FileDetail({
  file,
  onReplace,
  onShare,
}: {
  file: StoredFileDetail;
  onReplace: (file: StoredFileDetail) => void;
  onShare: (file: StoredFileDetail) => void;
}) {
  const queryClient = useQueryClient();
  const canReplace = useCan('file:library:replace');
  const [restoring, setRestoring] = useState<FileVersion | null>(null);
  const [current] = file.versions;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-start gap-2 pr-6 break-all">
          <FileIcon mimeType={file.mimeType} className="mt-0.5 size-5 shrink-0" />
          {file.name}
        </SheetTitle>
        <SheetDescription>
          {formatSize(file.size)} · 第 {file.version} 版
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-6 px-4 pb-6">
        <div className="flex flex-wrap gap-2">
          {canPreview(file.mimeType) && (
            <a
              href={fileContentUrl(file.id)}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Eye />
              预览
            </a>
          )}
          <a
            href={fileContentUrl(file.id, true)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Download />
            下载
          </a>
          <Can code="file:library:share">
            <Button variant="outline" size="sm" onClick={() => onShare(file)}>
              <Share2 />
              分享
            </Button>
          </Can>
          {canReplace && (
            <Button variant="outline" size="sm" onClick={() => onReplace(file)}>
              <Upload />
              上传新版本
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <Row label="位置">{['全部文件', ...file.path.map(({ name }) => name)].join(' / ')}</Row>
          <Row label="负责人">
            {file.owner.displayName}
            {file.dept && <span className="text-muted-foreground"> · {file.dept.name}</span>}
          </Row>
          <Row label="创建">
            {file.creator.displayName} · {formatDateTime(file.createdAt)}
          </Row>
          <Row label="更新">{formatDateTime(file.updatedAt)}</Row>
        </dl>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">用在哪里</h3>
          {file.usages.length === 0 && file.hiddenUsages === 0 ? (
            <p className="text-sm text-muted-foreground">没有被引用。</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {file.usages.map((usage) => (
                <li key={`${usage.type}:${usage.id}`}>
                  客户「
                  <Link
                    to="/crm/customers/$customerId"
                    params={{ customerId: usage.id }}
                    className="hover:underline"
                  >
                    {usage.name}
                  </Link>
                  」的附件
                </li>
              ))}
              {file.hiddenUsages > 0 && (
                <li className="text-muted-foreground">还有 {file.hiddenUsages} 处你看不到的记录</li>
              )}
            </ul>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">版本</h3>
          <p className="text-xs text-muted-foreground">
            保留当前版本和最近 10 个历史版本，更早的自动清理。恢复旧版本会生成一个新版本。
          </p>
          <ul className="divide-y rounded-md border">
            {file.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">第 {version.number} 版</span>
                    {version === current && <Badge variant="secondary">当前</Badge>}
                    {version.restoredFrom && (
                      <span className="text-xs text-muted-foreground">
                        恢复自第 {version.restoredFrom} 版
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatSize(version.size)} · {version.uploader.displayName} ·{' '}
                    {formatDateTime(version.createdAt)}
                  </div>
                </div>
                <a
                  href={versionContentUrl(file.id, version.id)}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  下载
                </a>
                {canReplace && version !== current && (
                  <Button variant="ghost" size="sm" onClick={() => setRestoring(version)}>
                    恢复
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {restoring && (
        <ConfirmDialog
          title={`恢复到第 ${restoring.number} 版？`}
          description={`会生成第 ${file.version + 1} 版，内容和第 ${restoring.number} 版一样；现在的版本保留在历史里。引用和外链会用上恢复后的内容。`}
          confirmLabel="恢复"
          action={async () => {
            await restoreVersion(file.id, restoring.id);
            await refreshFiles(queryClient);
          }}
          onClosed={() => setRestoring(null)}
        />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
