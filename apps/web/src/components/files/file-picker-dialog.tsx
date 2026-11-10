import type { StoredFile } from '@fld/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder } from 'lucide-react';
import { useState } from 'react';
import { FileIcon } from '@/components/files/file-icon';
import { FolderBreadcrumb } from '@/components/files/folder-breadcrumb';
import { PaginationBar } from '@/components/pagination-bar';
import { SearchBox } from '@/components/search-box';
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
import { filesQuery, folderPath, folderQuery, foldersQuery, formatSize } from '@/lib/files';
import { PAGE_SIZE } from '@/lib/system';

/** As many as one request may attach. */
const MAX_PICKED = 50;

interface FilePickerDialogProps {
  title: string;
  description: string;
  /** Files picked before, shown as such and not offered again. */
  pickedIds: ReadonlySet<string>;
  /** If it fails, the dialog stays open and shows why. */
  pick: (fileIds: string[]) => Promise<unknown>;
  onClosed: () => void;
}

/** Picks files from the library, browsing its folders or searching it by name. */
export function FilePickerDialog({
  title,
  description,
  pickedIds,
  pick,
  onClosed,
}: FilePickerDialogProps) {
  const dialog = useMountedDialog(onClosed);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const browsing = keyword === undefined;
  const folder = useQuery({
    ...folderQuery(folderId ?? ''),
    enabled: browsing && folderId !== null,
  });
  const folders = useQuery({ ...foldersQuery(folderId), enabled: browsing });
  const files = useQuery(
    filesQuery({ page, folderId: browsing ? (folderId ?? undefined) : undefined, keyword }),
  );
  const mutation = useMutation({ mutationFn: () => pick([...selected]), onSuccess: dialog.close });
  const error = mutation.error ?? folder.error ?? folders.error ?? files.error;
  const subfolders = browsing && page === 1 ? (folders.data ?? []) : [];

  function open(id: string | null) {
    setFolderId(id);
    setKeyword(undefined);
    setPage(1);
  }

  function toggle(file: StoredFile, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!checked) {
        next.delete(file.id);
      } else if (next.size < MAX_PICKED) {
        next.add(file.id);
      }
      return next;
    });
  }

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {browsing ? (
            <FolderBreadcrumb path={folderId ? folderPath(folder.data) : []} onOpen={open} />
          ) : (
            <span className="text-sm">
              搜索「{keyword}」的结果
              <Button variant="link" size="sm" onClick={() => open(folderId)}>
                返回文件夹
              </Button>
            </span>
          )}
          <SearchBox
            value={keyword}
            placeholder="按文件名搜索"
            onSearch={(next) => {
              setKeyword(next);
              setPage(1);
            }}
          />
        </div>
        <div className="h-80 overflow-y-auto rounded-md border">
          {files.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">加载中…</p>
          ) : subfolders.length === 0 && !files.data?.items.length ? (
            <p className="p-3 text-sm text-muted-foreground">
              {browsing ? '这个文件夹是空的。' : '没有找到文件。'}
            </p>
          ) : (
            <ul className="divide-y">
              {subfolders.map((subfolder) => (
                <li key={subfolder.id}>
                  <button
                    type="button"
                    onClick={() => open(subfolder.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{subfolder.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {files.data?.items.map((file) => {
                const picked = pickedIds.has(file.id);
                return (
                  <li key={file.id}>
                    <Label className="flex w-full items-center gap-2 px-3 py-2 font-normal hover:bg-muted">
                      <Checkbox
                        checked={picked || selected.has(file.id)}
                        disabled={picked}
                        onCheckedChange={(checked) => toggle(file, checked)}
                      />
                      <FileIcon
                        mimeType={file.mimeType}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {picked ? '已添加' : formatSize(file.size)}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {files.data && files.data.total > PAGE_SIZE && (
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={files.data.total}
            onPageChange={setPage}
          />
        )}
        <DialogFooter className="items-center">
          <span className="text-sm text-muted-foreground sm:mr-auto">
            已选 {selected.size} 个
            {selected.size >= MAX_PICKED && `，一次最多添加 ${MAX_PICKED} 个`}
          </span>
          <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
            取消
          </DialogClose>
          <Button
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '添加中…' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
