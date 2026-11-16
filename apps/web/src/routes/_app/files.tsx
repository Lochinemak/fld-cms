import { extensionOf } from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import { ErrorAlert } from '@/components/error-alert';
import { FileDetailSheet } from '@/components/files/file-detail-sheet';
import { FileDialogs, type DialogState, type FileRef } from '@/components/files/file-dialogs';
import { FileDropZone } from '@/components/files/file-drop-zone';
import { FileRow, FolderRow } from '@/components/files/file-rows';
import { FolderBreadcrumb } from '@/components/files/folder-breadcrumb';
import { UploadList, useUploads } from '@/components/files/upload-queue';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import {
  filesQuery,
  folderPath,
  folderQuery,
  foldersQuery,
  refreshFiles,
  uploadPath,
  versionUploadPath,
} from '@/lib/files';
import { PAGE_SIZE } from '@/lib/system';

const searchSchema = z.object({
  /** The folder shown; the top level when left out. */
  folder: z.string().optional().catch(undefined),
  /** Searches every folder instead. */
  keyword: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/files')({
  validateSearch: searchSchema,
  component: () => (
    <RequirePermission code="file:library">
      <FilesPage />
    </RequirePermission>
  ),
});

function FilesPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const folderId = search.folder ?? null;
  const keyword = search.keyword;
  const browsing = keyword === undefined;
  const page = search.page ?? 1;
  const folder = useQuery({ ...folderQuery(folderId ?? ''), enabled: folderId !== null });
  const folders = useQuery({ ...foldersQuery(folderId), enabled: browsing });
  const files = useQuery(
    filesQuery({ page, folderId: browsing ? (folderId ?? undefined) : undefined, keyword }),
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = () => setDialog(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<FileRef | null>(null);
  const [notice, setNotice] = useState<string>();
  const uploads = useUploads(() => refreshFiles(queryClient));
  const picker = useRef<HTMLInputElement>(null);
  const replacer = useRef<HTMLInputElement>(null);
  const canUpload = useCan('file:library:upload');
  const canCreateFolder = useCan('file:library:folder');

  // New files and folders go where the user is browsing, once it is known to exist.
  const canAddHere = browsing && (folderId === null || !!folder.data);
  const here = folderId === null ? '全部文件' : (folder.data?.name ?? '');
  const subfolders = browsing && page === 1 ? (folders.data ?? []) : [];
  const fileCount = files.data?.total ?? 0;
  const folderCount = browsing ? (folders.data?.length ?? 0) : 0;
  const columns = browsing ? 5 : 6;
  const error = folder.error ?? folders.error ?? files.error;

  const open = (id: string | null) => void navigate({ search: { folder: id ?? undefined } });

  function uploadHere(picked: File[]) {
    uploads.add(picked.map((file) => ({ file, path: uploadPath(folderId) })));
  }

  function uploadPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    setNotice(undefined);
    uploadHere(picked);
  }

  function pickReplacement(file: FileRef) {
    const input = replacer.current;
    if (input) {
      setReplacing(file);
      const extension = extensionOf(file.name);
      input.accept = extension ? `.${extension}` : '';
      input.click();
    }
  }

  function replacePicked(event: ChangeEvent<HTMLInputElement>) {
    const [file] = event.currentTarget.files ?? [];
    event.currentTarget.value = '';
    if (file && replacing) {
      uploads.add([
        { file, path: versionUploadPath(replacing.id), label: `${replacing.name}（新版本）` },
      ]);
    }
  }

  function uploadDropped(dropped: File[], skipped: number) {
    setNotice(skipped > 0 ? `不能直接上传文件夹，已跳过 ${skipped} 个文件夹。` : undefined);
    uploadHere(dropped);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="文件"
        description="只列出你的数据范围内的文件和文件夹。"
        actions={
          <>
            {canCreateFolder && (
              <Button
                variant="outline"
                disabled={!canAddHere}
                onClick={() => setDialog({ kind: 'create-folder' })}
              >
                <FolderPlus />
                新建文件夹
              </Button>
            )}
            {canUpload && (
              <Button disabled={!canAddHere} onClick={() => picker.current?.click()}>
                <Upload />
                上传
              </Button>
            )}
            <input ref={picker} type="file" multiple hidden onChange={uploadPicked} />
            <input ref={replacer} type="file" hidden onChange={replacePicked} />
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {browsing ? (
            <FolderBreadcrumb path={folderPath(folderId ? folder.data : undefined)} onOpen={open} />
          ) : (
            <div className="flex items-center gap-1 text-sm">
              在所有文件夹里搜索「{keyword}」
              <Button
                variant="link"
                size="sm"
                onClick={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, keyword: undefined, page: undefined }),
                  })
                }
              >
                清除搜索
              </Button>
            </div>
          )}
          <SearchBox
            value={keyword}
            placeholder="按文件名搜索"
            onSearch={(next) =>
              void navigate({ search: (prev) => ({ ...prev, keyword: next, page: undefined }) })
            }
          />
        </div>
        <ErrorAlert error={error} />
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <UploadList tasks={uploads.tasks} onClear={uploads.clearFinished} />
        <FileDropZone enabled={canUpload && canAddHere} here={here} onDrop={uploadDropped}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>大小</TableHead>
                {!browsing && <TableHead>位置</TableHead>}
                <TableHead>负责人</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.isPending || (browsing && folders.isPending) ? (
                <TableMessage colSpan={columns}>加载中…</TableMessage>
              ) : subfolders.length === 0 && !files.data?.items.length ? (
                <TableMessage colSpan={columns}>
                  {!browsing
                    ? '没有找到文件'
                    : canUpload && canAddHere
                      ? '这里还没有文件，把文件拖到这里就能上传'
                      : '这里还没有文件'}
                </TableMessage>
              ) : (
                <>
                  {subfolders.map((subfolder) => (
                    <FolderRow
                      key={`folder:${subfolder.id}`}
                      folder={subfolder}
                      onOpen={open}
                      onAction={setDialog}
                    />
                  ))}
                  {files.data?.items.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      showFolder={!browsing}
                      onOpen={open}
                      onDetail={setDetailId}
                      onReplace={pickReplacement}
                      onAction={setDialog}
                    />
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </FileDropZone>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={fileCount}
          summary={
            folderCount > 0
              ? `${folderCount} 个文件夹，${fileCount} 个文件`
              : `共 ${fileCount} 个文件`
          }
          onPageChange={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
        />
      </div>
      <FileDialogs dialog={dialog} folderId={folderId} here={here} onClosed={closeDialog} />
      {detailId && (
        <FileDetailSheet
          fileId={detailId}
          onReplace={pickReplacement}
          onShare={(file) => setDialog({ kind: 'share', file })}
          onClosed={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
