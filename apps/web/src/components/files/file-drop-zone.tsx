import { useEffect, useState, type DragEvent, type ReactNode } from 'react';

interface FileDropZoneProps {
  /** Whether files dropped here are taken. */
  enabled: boolean;
  /** The name of the folder the files go to. */
  here: string;
  /** The files dropped, and how many folders were left out. */
  onDrop: (files: File[], skipped: number) => void;
  children: ReactNode;
}

/** Around the file list: takes the files dragged onto it. */
export function FileDropZone({ enabled, here, onDrop, children }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);

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

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (enabled && event.dataTransfer.types.includes('Files')) {
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
    if (!enabled) {
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
    onDrop(dropped, skipped);
  }

  return (
    <div
      className="relative rounded-lg border"
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85 text-sm font-medium">
          松开就能上传到「{here}」
        </div>
      )}
    </div>
  );
}
