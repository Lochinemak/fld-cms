import { fileNameSchema, storedFileSchema, type StoredFile } from '@fld/shared';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { upload } from '@/lib/api';
import { formatSize } from '@/lib/files';
import { cn } from '@/lib/utils';

export interface UploadRequest {
  file: File;
  /** Where the file is posted: see `uploadPath` and `versionUploadPath`. */
  path: string;
  /**
   * What the list calls it. Without one it goes by the file's own name, and says what it was saved
   * as when that differs, as when the name was taken.
   */
  label?: string;
  /** Runs once the file is in, say to attach it to a record. */
  afterUpload?: (uploaded: StoredFile) => Promise<unknown>;
}

interface UploadTask extends UploadRequest {
  id: number;
  sent: number;
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: string;
  savedAs?: string;
}

/**
 * Uploads files one after another, keeping each one's progress. One at a time, so that names
 * already taken are numbered in the order the files were picked.
 */
export function useUploads(refresh: () => Promise<unknown>) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const waiting = useRef<UploadTask[]>([]);
  const running = useRef(false);
  const nextId = useRef(1);

  const update = (id: number, patch: Partial<UploadTask>) =>
    setTasks((all) => all.map((task) => (task.id === id ? { ...task, ...patch } : task)));

  async function run() {
    running.current = true;
    for (let task = waiting.current.shift(); task; task = waiting.current.shift()) {
      const { id } = task;
      update(id, { status: 'uploading' });
      try {
        const uploaded = await upload(task.path, task.file, {
          schema: storedFileSchema,
          onProgress: (sent) => update(id, { sent }),
        });
        await task.afterUpload?.(uploaded);
        const renamed = uploaded.name.normalize() !== task.file.name.normalize();
        update(id, {
          status: 'done',
          sent: task.file.size,
          savedAs: task.label === undefined && renamed ? uploaded.name : undefined,
        });
      } catch (error) {
        update(id, { status: 'failed', error: (error as Error).message });
      }
      await refresh();
    }
    running.current = false;
  }

  function add(requests: UploadRequest[]) {
    const added = requests.map((request): UploadTask => {
      // Refused names fail at once, without sending the file first.
      const name = fileNameSchema.safeParse(request.file.name);
      return name.success
        ? { ...request, id: nextId.current++, sent: 0, status: 'waiting' }
        : {
            ...request,
            id: nextId.current++,
            sent: 0,
            status: 'failed',
            error: name.error.issues[0]?.message,
          };
    });
    setTasks((all) => [...all, ...added]);
    waiting.current.push(...added.filter((task) => task.status === 'waiting'));
    if (!running.current) {
      void run();
    }
  }

  const clearFinished = () =>
    setTasks((all) =>
      all.filter((task) => task.status === 'waiting' || task.status === 'uploading'),
    );

  return { tasks, add, clearFinished };
}

function percent(task: UploadTask): number {
  return task.file.size === 0 ? 100 : Math.min(100, Math.round((task.sent / task.file.size) * 100));
}

const STATUS_TEXT = { waiting: '等待中', done: '已完成' } as const;

/** The uploads of `useUploads`, with their progress; nothing until there are some. */
export function UploadList({
  tasks,
  onClear,
}: Pick<ReturnType<typeof useUploads>, 'tasks'> & { onClear: () => void }) {
  if (tasks.length === 0) {
    return null;
  }
  const finished = tasks.filter((task) => task.status === 'done' || task.status === 'failed');
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          上传 {finished.length}/{tasks.length}
        </span>
        {finished.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            清除已结束的
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{task.label ?? task.file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatSize(task.file.size)}
                {' · '}
                <span
                  className={cn(
                    task.status === 'failed' && 'text-destructive',
                    task.status === 'done' && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {task.status === 'uploading'
                    ? `${percent(task)}%`
                    : task.status === 'failed'
                      ? '失败'
                      : STATUS_TEXT[task.status]}
                </span>
              </span>
            </div>
            {task.status === 'uploading' && (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${percent(task)}%` }}
                />
              </div>
            )}
            {task.savedAs && (
              <p className="text-xs text-muted-foreground">已存为「{task.savedAs}」</p>
            )}
            {task.error && <p className="text-xs text-destructive">{task.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
