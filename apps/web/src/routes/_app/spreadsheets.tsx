import { SPREADSHEET_ENTITIES, SPREADSHEET_KEEP_DAYS, type SpreadsheetTask } from '@fld/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { TableMessage } from '@/components/table-message';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMountedDialog } from '@/hooks/use-mounted-dialog';
import { formatDateTime } from '@/lib/crm';
import {
  SPREADSHEET_STATUS_LABELS,
  spreadsheetDownloadUrl,
  spreadsheetsQuery,
} from '@/lib/spreadsheets';

export const Route = createFileRoute('/_app/spreadsheets')({
  component: SpreadsheetsPage,
});

const STATUS_VARIANTS = {
  PENDING: 'outline',
  RUNNING: 'secondary',
  DONE: 'default',
  FAILED: 'destructive',
} as const satisfies Record<SpreadsheetTask['status'], string>;

const COLUMNS = 7;

/** The member's own exports and imports. */
function SpreadsheetsPage() {
  const { data, error, isPending } = useQuery(spreadsheetsQuery);
  const [problems, setProblems] = useState<SpreadsheetTask | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="导入导出"
        description={`你发起的导出和导入，文件保留 ${SPREADSHEET_KEEP_DAYS} 天。`}
      />
      <ErrorAlert error={error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>数据</TableHead>
              <TableHead>文件</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>行数</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableMessage colSpan={COLUMNS}>加载中…</TableMessage>
            ) : !data?.length ? (
              <TableMessage colSpan={COLUMNS}>还没有导入或导出</TableMessage>
            ) : (
              data.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Badge variant={task.kind === 'EXPORT' ? 'secondary' : 'outline'}>
                      {task.kind === 'EXPORT' ? '导出' : '导入'}
                    </Badge>
                  </TableCell>
                  <TableCell>{SPREADSHEET_ENTITIES[task.entity].name}</TableCell>
                  <TableCell className="max-w-64 break-all">{task.fileName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[task.status]}>
                      {SPREADSHEET_STATUS_LABELS[task.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{task.rowCount ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{formatDateTime(task.createdAt)} 开始</div>
                    {task.finishedAt && <div>{formatDateTime(task.finishedAt)} 结束</div>}
                  </TableCell>
                  <TableCell>
                    <TaskActions task={task} onShowProblems={() => setProblems(task)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {problems && <ProblemsDialog task={problems} onClosed={() => setProblems(null)} />}
    </div>
  );
}

function TaskActions({
  task,
  onShowProblems,
}: {
  task: SpreadsheetTask;
  onShowProblems: () => void;
}) {
  if (task.downloadable) {
    return (
      <a
        href={spreadsheetDownloadUrl(task.id)}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        下载
      </a>
    );
  }
  if (task.status !== 'FAILED') {
    return null;
  }
  if (task.kind === 'IMPORT' && task.rowErrors.length > 0) {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onShowProblems}>
          查看问题
        </Button>
      </div>
    );
  }
  return task.error ? <p className="max-w-64 text-xs text-destructive">{task.error}</p> : null;
}

/** The rows of a failed import at fault. */
function ProblemsDialog({ task, onClosed }: { task: SpreadsheetTask; onClosed: () => void }) {
  const dialog = useMountedDialog(onClosed);
  return (
    <Dialog {...dialog.rootProps()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入的问题</DialogTitle>
          <DialogDescription>
            「{task.fileName}」没有导入任何一行，改好下面的行后重新导入。
          </DialogDescription>
        </DialogHeader>
        {task.error && <p className="text-sm text-destructive">{task.error}</p>}
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
          {task.rowErrors.map((problem, index) => (
            <li key={index}>
              第 {problem.row} 行：{problem.message}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
