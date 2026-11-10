import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Folder } from 'lucide-react';
import { useState } from 'react';
import { FolderBreadcrumb } from '@/components/files/folder-breadcrumb';
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
import { folderPath, folderQuery, foldersQuery, refreshFiles } from '@/lib/files';

interface MoveDialogProps {
  /** What moves, such as 文件「a.pdf」. */
  subject: string;
  /** The folder it is in now; null at the top level. */
  parentId: string | null;
  /** The folder that moves, which can't go into itself. */
  movingFolderId?: string;
  /** If it fails, the dialog stays open and shows why. */
  move: (parentId: string | null) => Promise<unknown>;
  onClosed: () => void;
}

/** Picks the folder to move a file or folder into, browsing down from the top level. */
export function MoveDialog({ subject, parentId, movingFolderId, move, onClosed }: MoveDialogProps) {
  const queryClient = useQueryClient();
  const dialog = useMountedDialog(onClosed);
  const [target, setTarget] = useState(parentId);
  const folder = useQuery({ ...folderQuery(target ?? ''), enabled: target !== null });
  const folders = useQuery(foldersQuery(target));
  const mutation = useMutation({
    mutationFn: () => move(target),
    onSuccess: async () => {
      await refreshFiles(queryClient);
      dialog.close();
    },
  });
  const subfolders = folders.data?.filter(({ id }) => id !== movingFolderId);
  const error = mutation.error ?? folder.error ?? folders.error;

  return (
    <Dialog {...dialog.rootProps(mutation.isPending)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动{subject}</DialogTitle>
          <DialogDescription>
            移进文件夹后，负责人和所属部门跟着文件夹走；移到「全部文件」最外层的，归创建人自己。
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <FolderBreadcrumb path={target ? folderPath(folder.data) : []} onOpen={setTarget} />
        <div className="h-64 overflow-y-auto rounded-md border">
          {!subfolders ? (
            <p className="p-3 text-sm text-muted-foreground">{folders.isPending && '加载中…'}</p>
          ) : subfolders.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">这里没有子文件夹。</p>
          ) : (
            <ul className="divide-y">
              {subfolders.map((subfolder) => (
                <li key={subfolder.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(subfolder.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{subfolder.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={mutation.isPending}>
            取消
          </DialogClose>
          <Button
            disabled={
              mutation.isPending || target === parentId || (target !== null && !folder.data)
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '移动中…' : '移到这里'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
