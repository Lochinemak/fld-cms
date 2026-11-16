import type { FileFolder, StoredFile } from '@fld/shared';
import { Ellipsis, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DialogState } from '@/components/files/file-dialogs';
import { FileIcon } from '@/components/files/file-icon';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/crm';
import { canPreview, fileContentUrl, formatSize } from '@/lib/files';

interface FolderRowProps {
  folder: FileFolder;
  /** Opens a folder, or the top level for null. */
  onOpen: (folderId: string | null) => void;
  onAction: (state: DialogState) => void;
}

/** A folder in the file list, with the actions the user may take on it. */
export function FolderRow({ folder, onOpen, onAction }: FolderRowProps) {
  const canEdit = useCan('file:library:edit');
  const canDelete = useCan('file:library:delete');

  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={() => onOpen(folder.id)}
          className="flex max-w-md items-center gap-2 text-left font-medium hover:underline"
        >
          <Folder className="size-4 shrink-0 text-amber-500" />
          <span className="truncate">{folder.name}</span>
        </button>
      </TableCell>
      <TableCell className="text-muted-foreground">—</TableCell>
      <OwnerCell item={folder} />
      <TableCell className="text-muted-foreground">{formatDateTime(folder.updatedAt)}</TableCell>
      <TableCell>
        {(canEdit || canDelete) && (
          <RowMenu label={`「${folder.name}」的操作`}>
            {canEdit && (
              <>
                <DropdownMenuItem onClick={() => onAction({ kind: 'rename-folder', folder })}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction({ kind: 'move-folder', folder })}>
                  移动
                </DropdownMenuItem>
              </>
            )}
            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction({ kind: 'delete-folder', folder })}
              >
                删除
              </DropdownMenuItem>
            )}
          </RowMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

interface FileRowProps {
  file: StoredFile;
  /** Adds the folder the file is in, for a search across folders. */
  showFolder: boolean;
  /** Opens a folder, or the top level for null. */
  onOpen: (folderId: string | null) => void;
  onDetail: (fileId: string) => void;
  /** Picks the file's new version. */
  onReplace: (file: StoredFile) => void;
  onAction: (state: DialogState) => void;
}

/** A file in the file list, with the actions the user may take on it. */
export function FileRow({ file, showFolder, onOpen, onDetail, onReplace, onAction }: FileRowProps) {
  const canEdit = useCan('file:library:edit');
  const canReplace = useCan('file:library:replace');
  const canDelete = useCan('file:library:delete');
  const canShare = useCan('file:library:share');

  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={() => onDetail(file.id)}
          className="flex max-w-md items-center gap-2 text-left font-medium hover:underline"
        >
          <FileIcon mimeType={file.mimeType} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.name}</span>
        </button>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatSize(file.size)}</TableCell>
      {showFolder && (
        <TableCell>
          <button
            type="button"
            onClick={() => onOpen(file.folder?.id ?? null)}
            className="max-w-48 truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            {file.folder?.name ?? '全部文件'}
          </button>
        </TableCell>
      )}
      <OwnerCell item={file} />
      <TableCell className="text-muted-foreground">{formatDateTime(file.updatedAt)}</TableCell>
      <TableCell>
        <RowMenu label={`「${file.name}」的操作`}>
          {canPreview(file.mimeType) && (
            <DropdownMenuItem
              onClick={() => window.open(fileContentUrl(file.id), '_blank', 'noopener')}
            >
              预览
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => window.location.assign(fileContentUrl(file.id, true))}>
            下载
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDetail(file.id)}>详情和版本</DropdownMenuItem>
          {canShare && (
            <DropdownMenuItem onClick={() => onAction({ kind: 'share', file })}>
              分享
            </DropdownMenuItem>
          )}
          {(canEdit || canReplace || canDelete) && <DropdownMenuSeparator />}
          {canEdit && (
            <>
              <DropdownMenuItem onClick={() => onAction({ kind: 'rename-file', file })}>
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction({ kind: 'move-file', file })}>
                移动
              </DropdownMenuItem>
            </>
          )}
          {canReplace && (
            <DropdownMenuItem onClick={() => onReplace(file)}>上传新版本</DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction({ kind: 'delete-file', file })}
            >
              删除
            </DropdownMenuItem>
          )}
        </RowMenu>
      </TableCell>
    </TableRow>
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
