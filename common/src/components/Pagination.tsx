import { useLanguageStore } from '../stores/language';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number | ((p: number) => number)) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { t } = useLanguageStore();

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-800/50">
      <button
        onClick={() => onPageChange((p: number) => Math.max(0, p - 1))}
        disabled={page === 0}
        className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {t('prev')}
      </button>
      <span className="text-xs text-gray-500 font-mono">{page + 1} / {totalPages}</span>
      <button
        onClick={() => onPageChange((p: number) => Math.min(totalPages - 1, p + 1))}
        disabled={page === totalPages - 1}
        className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {t('next')}
      </button>
    </div>
  );
}
