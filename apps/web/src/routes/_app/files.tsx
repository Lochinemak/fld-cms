import {
  extensionOf,
  fileNameSchema,
  folderNameSchema,
  type FileFolder,
  type StoredFile,
} from '@fld/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Ellipsis, Folder, FolderPlus, Upload } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FileDetailSheet } from '@/components/files/file-detail-sheet';
import { FileIcon } from '@/components/files/file-icon';
import { FolderBreadcrumb } from '@/components/files/folder-breadcrumb';
import { MoveDialog } from '@/components/files/move-dialog';
import { NameDialog } from '@/components/files/name-dialog';
import { ShareDialog } from '@/components/files/share-dialog';
import { UploadList, useUploads } from '@/components/files/upload-queue';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { RequirePermission } from '@/components/require-permission';
import { SearchBox } from '@/components/search-box';
import { TableMessage } from '@/components/table-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/crm';
import {
  canPreview,
  createFolder,
  deleteFile,
  deleteFolder,
  fileContentUrl,
  filesQuery,
  folderPath,
  folderQuery,
  foldersQuery,
  formatSize,
  refreshFiles,
  updateFile,
  updateFolder,
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

interface FileRef {
  id: string;
  name: string;
}

type DialogState =
  | { kind: 'create-folder' }
  | { kind: 'rename-folder'; folder: FileFolder }
  | { kind: 'move-folder'; folder: FileFolder }
  | { kind: 'delete-folder'; folder: FileFolder }
  | { kind: 'rename-file'; file: StoredFile }
  | { kind: 'move-file'; file: StoredFile }
  | { kind: 'delete-file'; file: StoredFile }
  | { kind: 'share'; file: FileRef };

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
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const uploads = useUploads(() => refreshFiles(queryClient));
  const picker = useRef<HTMLInputElement>(null);
  const replacer = useRef<HTMLInputElement>(null);
  const canUpload = useCan('file:library:upload');
  const canCreateFolder = useCan('file:library:folder');
  const canEdit = useCan('file:library:edit');
  const canReplace = useCan('file:library:replace');
  const canDelete = useCan('file:library:delete');
  const canShare = useCan('file:library:share');

  // New files and folders go where the user is browsing, once it is known to exist.
  const canAddHere = browsing && (folderId === null || !!folder.data);
  const here = folderId === null ? '全部文件' : (folder.data?.name ?? '');
  const subfolders = browsing && page === 1 ? (folders.data ?? []) : [];
  const fileCount = files.data?.total ?? 0;
  const folderCount = browsing ? (folders.data?.length ?? 0) : 0;
  const columns = browsing ? 5 : 6;
  const error = folder.error ?? folders.error ?? files.error;

  // A file dropped beside the drop zone would otherwise open in place of the page.
  useEffect(() => {
    const ignore = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

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

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (canUpload && canAddHere && event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setDragging(true);
    }
  }

  function dragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    setDragging(false);
    if (!canUpload || !canAddHere) {
      return;
    }
    const dropped: File[] = [];
    let skipped = 0;
    for (const item of Array.from(event.dataTransfer.items)) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (item.webkitGetAsEntry()?.isDirectory) {
        skipped++;
      } else if (file) {
        dropped.push(file);
      }
    }
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
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <UploadList tasks={uploads.tasks} onClear={uploads.clearFinished} />
        <div
          className="relative rounded-lg border"
          onDragOver={dragOver}
          onDragLeave={dragLeave}
          onDrop={drop}
        >
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
                    <TableRow key={`folder:${subfolder.id}`}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => open(subfolder.id)}
                          className="flex max-w-md items-center gap-2 text-left font-medium hover:underline"
                        >
                          <Folder className="size-4 shrink-0 text-amber-500" />
                          <span className="truncate">{subfolder.name}</span>
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <OwnerCell item={subfolder} />
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(subfolder.updatedAt)}
                      </TableCell>
                      <TableCell>
                        {(canEdit || canDelete) && (
                          <RowMenu label={`「${subfolder.name}」的操作`}>
                            {canEdit && (
                              <>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setDialog({ kind: 'rename-folder', folder: subfolder })
                                  }
                                >
                                  重命名
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setDialog({ kind: 'move-folder', folder: subfolder })
                                  }
                                >
                                  移动
                                </DropdownMenuItem>
                              </>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setDialog({ kind: 'delete-folder', folder: subfolder })
                                }
                              >
                                删除
                              </DropdownMenuItem>
                            )}
                          </RowMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {files.data?.items.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setDetailId(file.id)}
                          className="flex max-w-md items-center gap-2 text-left font-medium hover:underline"
                        >
                          <FileIcon
                            mimeType={file.mimeType}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate">{file.name}</span>
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatSize(file.size)}
                      </TableCell>
                      {!browsing && (
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => open(file.folder?.id ?? null)}
                            className="max-w-48 truncate text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {file.folder?.name ?? '全部文件'}
                          </button>
                        </TableCell>
                      )}
                      <OwnerCell item={file} />
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(file.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <RowMenu label={`「${file.name}」的操作`}>
                          {canPreview(file.mimeType) && (
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(fileContentUrl(file.id), '_blank', 'noopener')
                              }
                            >
                              预览
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => window.location.assign(fileContentUrl(file.id, true))}
                          >
                            下载
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDetailId(file.id)}>
                            详情和版本
                          </DropdownMenuItem>
                          {canShare && (
                            <DropdownMenuItem onClick={() => setDialog({ kind: 'share', file })}>
                              分享
                            </DropdownMenuItem>
                          )}
                          {(canEdit || canReplace || canDelete) && <DropdownMenuSeparator />}
                          {canEdit && (
                            <>
                              <DropdownMenuItem
                                onClick={() => setDialog({ kind: 'rename-file', file })}
                              >
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDialog({ kind: 'move-file', file })}
                              >
                                移动
                              </DropdownMenuItem>
                            </>
                          )}
                          {canReplace && (
                            <DropdownMenuItem onClick={() => pickReplacement(file)}>
                              上传新版本
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDialog({ kind: 'delete-file', file })}
                            >
                              删除
                            </DropdownMenuItem>
                          )}
                        </RowMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85 text-sm font-medium">
              松开就能上传到「{here}」
            </div>
          )}
        </div>
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
      {dialog?.kind === 'create-folder' && (
        <NameDialog
          title="新建文件夹"
          description={`建在「${here}」里。`}
          label="文件夹名称"
          schema={folderNameSchema}
          save={(name) => createFolder({ name, parentId: folderId })}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'rename-folder' && (
        <NameDialog
          title="重命名文件夹"
          description={`给文件夹「${dialog.folder.name}」改个名字。`}
          label="文件夹名称"
          name={dialog.folder.name}
          schema={folderNameSchema}
          save={(name) => updateFolder(dialog.folder.id, { name })}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'rename-file' && (
        <NameDialog
          title="重命名文件"
          description="改名不影响客户里的附件和已发出的外链。"
          label="文件名"
          name={dialog.file.name}
          keepExtension
          schema={fileNameSchema}
          save={(name) => updateFile(dialog.file.id, { name })}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'move-folder' && (
        <MoveDialog
          subject={`文件夹「${dialog.folder.name}」`}
          parentId={dialog.folder.parentId}
          movingFolderId={dialog.folder.id}
          move={(parentId) => updateFolder(dialog.folder.id, { parentId })}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'move-file' && (
        <MoveDialog
          subject={`文件「${dialog.file.name}」`}
          parentId={dialog.file.folder?.id ?? null}
          move={(parentId) => updateFile(dialog.file.id, { folderId: parentId })}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          title={`删除文件夹「${dialog.folder.name}」？`}
          description="里面的文件和子文件夹会一起删除，删除后无法在页面上找回，它们的外链也会立即失效。里面有文件正被客户引用时不能删除。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteFolder(dialog.folder.id);
            await refreshFiles(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'delete-file' && (
        <ConfirmDialog
          title={`删除文件「${dialog.file.name}」？`}
          description="删除后无法在页面上找回，它的外链也会立即失效。正被客户引用的文件不能删除。"
          confirmLabel="删除"
          destructive
          action={async () => {
            await deleteFile(dialog.file.id);
            await refreshFiles(queryClient);
          }}
          onClosed={closeDialog}
        />
      )}
      {dialog?.kind === 'share' && <ShareDialog file={dialog.file} onClosed={closeDialog} />}
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

function OwnerCell({ item }: { item: Pick<StoredFile, 'owner' | 'dept'> }) {
  return (
    <TableCell>
      <div>{item.owner.displayName}</div>
      {item.dept && <div className="text-xs text-muted-foreground">{item.dept.name}</div>}
    </TableCell>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
