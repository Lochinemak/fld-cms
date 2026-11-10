import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { FolderRef } from '@/lib/files';

interface FolderBreadcrumbProps {
  /** See `folderPath`. */
  path: FolderRef[];
  /** Opens a folder on the way, or the top level for null. */
  onOpen: (folderId: string | null) => void;
}

export function FolderBreadcrumb({ path, onOpen }: FolderBreadcrumbProps) {
  return (
    <nav aria-label="文件夹路径" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <Crumb current={path.length === 0} onClick={() => onOpen(null)}>
        全部文件
      </Crumb>
      {path.map((folder, index) => (
        <Fragment key={folder.id}>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <Crumb current={index === path.length - 1} onClick={() => onOpen(folder.id)}>
            {folder.name}
          </Crumb>
        </Fragment>
      ))}
    </nav>
  );
}

function Crumb({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return current ? (
    <span aria-current="page" className="max-w-48 truncate font-medium">
      {children}
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className="max-w-48 truncate text-muted-foreground hover:text-foreground hover:underline"
    >
      {children}
    </button>
  );
}
