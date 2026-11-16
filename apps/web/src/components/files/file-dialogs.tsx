import { fileNameSchema, folderNameSchema, type FileFolder, type StoredFile } from '@fld/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MoveDialog } from '@/components/files/move-dialog';
import { NameDialog } from '@/components/files/name-dialog';
import { ShareDialog } from '@/components/files/share-dialog';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  refreshFiles,
  updateFile,
  updateFolder,
} from '@/lib/files';

export interface FileRef {
  id: string;
  name: string;
}

export type DialogState =
  | { kind: 'create-folder' }
  | { kind: 'rename-folder'; folder: FileFolder }
  | { kind: 'move-folder'; folder: FileFolder }
  | { kind: 'delete-folder'; folder: FileFolder }
  | { kind: 'rename-file'; file: StoredFile }
  | { kind: 'move-file'; file: StoredFile }
  | { kind: 'delete-file'; file: StoredFile }
  | { kind: 'share'; file: FileRef };

interface FileDialogsProps {
  /** The dialog that is open, if any. */
  dialog: DialogState | null;
  /** The folder being browsed, where a new folder goes; the top level for null. */
  folderId: string | null;
  /** The name of that folder. */
  here: string;
  onClosed: () => void;
}

/** The dialog for the action picked on the files page. */
export function FileDialogs({ dialog, folderId, here, onClosed }: FileDialogsProps) {
  const queryClient = useQueryClient();

  return (
    <>
      {dialog?.kind === 'create-folder' && (
        <NameDialog
          title="新建文件夹"
          description={`建在「${here}」里。`}
          label="文件夹名称"
          schema={folderNameSchema}
          save={(name) => createFolder({ name, parentId: folderId })}
          onClosed={onClosed}
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
          onClosed={onClosed}
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
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'move-folder' && (
        <MoveDialog
          subject={`文件夹「${dialog.folder.name}」`}
          parentId={dialog.folder.parentId}
          movingFolderId={dialog.folder.id}
          move={(parentId) => updateFolder(dialog.folder.id, { parentId })}
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'move-file' && (
        <MoveDialog
          subject={`文件「${dialog.file.name}」`}
          parentId={dialog.file.folder?.id ?? null}
          move={(parentId) => updateFile(dialog.file.id, { folderId: parentId })}
          onClosed={onClosed}
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
          onClosed={onClosed}
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
          onClosed={onClosed}
        />
      )}
      {dialog?.kind === 'share' && <ShareDialog file={dialog.file} onClosed={onClosed} />}
    </>
  );
}
