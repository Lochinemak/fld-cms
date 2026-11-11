import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  /** What is counted, in place of 「共 N 条」. */
  summary?: string;
  onPageChange: (page: number) => void;
}

export function PaginationBar({
  page,
  pageSize,
  total,
  summary,
  onPageChange,
}: PaginationBarProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // The page shown may no longer exist: after a removal, or from an old address.
  useEffect(() => {
    if (page > pages) {
      onPageChange(pages);
    }
  }, [page, pages, onPageChange]);

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <span>{summary ?? t('total', { count: total })}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('previousPage')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular-nums">{t('page', { page: Math.min(page, pages), pages })}</span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('nextPage')}
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
