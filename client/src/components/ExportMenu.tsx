import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguageStore } from 'common';

interface ExportMenuProps {
  onExportJson: () => void | Promise<void>;
  onExportCsv: () => void | Promise<void>;
  onExportTxt?: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}

const MENU_WIDTH = 144; // w-36
const VIEWPORT_MARGIN = 8;

export function ExportMenu({ onExportJson, onExportCsv, onExportTxt, disabled, busy }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguageStore();

  // Recompute the dropdown's fixed position from the button's bounding rect.
  // We render via a portal so no ancestor can clip us — the tradeoff is the
  // dropdown no longer inherits the button's layout position, so we compute it.
  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = rect.right - MENU_WIDTH; // align dropdown's right edge with button's right edge
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN;
    if (left > maxLeft) left = maxLeft;
    const top = rect.bottom + 4;
    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => reposition();
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const pick = (fn: () => void | Promise<void>) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
      >
        {busy ? t('exporting') : t('export')}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && coords && createPortal(
        // Rendered at document.body via portal to escape any ancestor with
        // overflow-hidden or a stacking context. Uses fixed positioning
        // calculated from the trigger button's bounding client rect.
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: MENU_WIDTH }}
          className="rounded-lg bg-gray-900 border border-gray-700/50 shadow-2xl z-[60] overflow-hidden"
        >
          <button
            onClick={() => pick(onExportJson)}
            className="block w-full text-start px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          >
            JSON
          </button>
          <button
            onClick={() => pick(onExportCsv)}
            className="block w-full text-start px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors border-t border-gray-800"
          >
            CSV
          </button>
          {onExportTxt && (
            <button
              onClick={() => pick(onExportTxt)}
              className="block w-full text-start px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors border-t border-gray-800"
            >
              {t('plainText')}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
