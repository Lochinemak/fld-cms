import { RECENT_FILES } from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ErrorAlert } from '@/components/error-alert';
import { FileIcon } from '@/components/files/file-icon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/crm';
import { recentFilesQuery } from '@/lib/files';

/**
 * The files uploaded or changed last. A file's name opens the file library at its folder, where
 * everything else is done with it. A row is one line where the card is wide and two where it
 * isn't.
 */
export function RecentFilesCard() {
  const { data, error } = useQuery(recentFilesQuery);

  return (
    <Card>
      <CardHeader>
        <CardTitle>最近文件</CardTitle>
        <CardDescription>
          最近上传或更新的 {RECENT_FILES} 个文件，点文件名打开它所在的文件夹
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorAlert error={error} />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有文件</p>
        ) : (
          <ul className="@container divide-y">
            {data.map((file) => (
              <li key={file.id} className="flex gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
                <FileIcon
                  mimeType={file.mimeType}
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-1 @lg:grid-cols-[minmax(0,1fr)_10rem_9rem]">
                  <Link
                    to="/files"
                    search={{ folder: file.folder?.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {file.name}
                  </Link>
                  <div className="flex min-w-0 gap-1.5 text-xs text-muted-foreground @lg:contents @lg:text-sm">
                    <span className="truncate">{file.folder?.name ?? '全部文件'}</span>
                    <span aria-hidden="true" className="@lg:hidden">
                      ·
                    </span>
                    <span className="shrink-0 tabular-nums @lg:text-right">
                      {formatDateTime(file.updatedAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
