import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationBar({ page, pageSize, total, onPageChange }: PaginationBarProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // The page shown may no longer exist: after a removal, or from an old address.
  useEffect(() => {
    if (page > pages) {
      onPageChange(pages);
    }
  }, [page, pages, onPageChange]);

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <span>共 {total} 条</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular-nums">
          第 {Math.min(page, pages)} / {pages} 页
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
