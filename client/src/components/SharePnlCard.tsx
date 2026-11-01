import { useRef, useState } from 'react';
import { useLanguageStore } from 'common';

interface SharePnlData {
  symbol: string;
  side: 'buy' | 'sell';
  pnl: number;
  pnlPct: number;
  entryPrice: number;
  exitPrice?: number;
  strategy: string;
  mode: string;
}

interface SharePnlModalProps {
  data: SharePnlData;
  onClose: () => void;
}

function drawCard(data: SharePnlData, t: (k: string) => string): HTMLCanvasElement {
  const W = 720;
  const pad = 48;
  // Pre-calculate height: logo(96) + symbol(36) + roi_label(16) + roi(90) + pnl(72) + price_label(12) + price(64) + divider(24) + strategy(20) + padding
  const H = pad + 96 + 36 + 16 + 90 + 72 + 12 + 64 + 24 + 20 + pad;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.5, '#1e293b');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Grid overlay
  const isProfit = data.pnl >= 0;
  const accent = isProfit ? 'rgba(34,197,94,' : 'rgba(239,68,68,';
  ctx.strokeStyle = `${accent}0.06)`;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  let y = pad;

  // Logo
  const logoGrad = ctx.createLinearGradient(pad, y, pad + 56, y + 56);
  logoGrad.addColorStop(0, '#3b82f6');
  logoGrad.addColorStop(1, '#4f46e5');
  roundRect(ctx, pad, y, 56, 56, 12);
  ctx.fillStyle = logoGrad;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('T', pad + 28, y + 38);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '24px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Trading Bot', pad + 72, y + 38);
  y += 96;

  // Symbol
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  const symbolText = data.symbol.replace('/', '');
  ctx.fillText(symbolText, pad, y);
  const symW = ctx.measureText(symbolText).width;

  // Side badge
  const sideText = data.side === 'buy' ? 'LONG' : 'SHORT';
  const sideBg = data.side === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
  const sideFg = data.side === 'buy' ? '#4ade80' : '#f87171';
  const sideBorder = data.side === 'buy' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
  const sideW = ctx.measureText(sideText).width + 24;
  const badgeX = pad + symW + 16;
  roundRect(ctx, badgeX, y - 28, sideW, 36, 8);
  ctx.fillStyle = sideBg;
  ctx.fill();
  ctx.strokeStyle = sideBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = sideFg;
  ctx.fillText(sideText, badgeX + 12, y - 4);

  // Mode badge
  const modeText = data.mode.toUpperCase();
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  const modeW = ctx.measureText(modeText).width + 20;
  const modeX = badgeX + sideW + 12;
  roundRect(ctx, modeX, y - 24, modeW, 28, 8);
  ctx.fillStyle = 'rgba(55,65,81,0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(75,85,99,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(modeText, modeX + 10, y - 5);
  y += 36;

  // ROI label
  ctx.fillStyle = '#6b7280';
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ROI', pad, y);
  y += 16;

  // ROI value
  const roiColor = isProfit ? '#4ade80' : '#f87171';
  ctx.fillStyle = roiColor;
  ctx.font = 'bold 80px -apple-system, BlinkMacSystemFont, monospace';
  const roiText = `${isProfit ? '+' : ''}${data.pnlPct.toFixed(2)}%`;
  ctx.fillText(roiText, pad, y + 72);
  y += 90;

  // Dollar PnL
  ctx.fillStyle = isProfit ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)';
  ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, monospace';
  ctx.fillText(`${isProfit ? '+' : ''}$${data.pnl.toFixed(2)}`, pad, y + 28);
  y += 72;

  // Prices
  ctx.fillStyle = '#6b7280';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(t('entryPrice').toUpperCase(), pad, y);
  if (data.exitPrice != null) ctx.fillText(t('exitPrice').toUpperCase(), W / 2, y);
  y += 12;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, monospace';
  ctx.fillText(`$${data.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, pad, y + 32);
  if (data.exitPrice != null) ctx.fillText(`$${data.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, W / 2, y + 32);
  y += 64;

  // Divider
  ctx.strokeStyle = 'rgba(55,65,81,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 24;

  // Strategy
  const strategyName = t(data.strategy) || data.strategy;
  ctx.fillStyle = '#4b5563';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`${t('strategy').toUpperCase()}: ${strategyName.toUpperCase()}`, pad, y + 4);

  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function SharePnlModal({ data, onClose }: SharePnlModalProps) {
  const { t } = useLanguageStore();
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  async function captureAndShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const canvas = drawCard(data, (k: string) => t(k as any) || k);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!blob) return;
      const fileName = `pnl-${data.symbol.replace('/', '-')}.png`;

      if (navigator.share) {
        const file = new File([blob], fileName, { type: 'image/png' });
        await navigator.share({ files: [file] });
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch {
      // User cancelled share
    } finally {
      setSharing(false);
    }
  }

  const isProfit = data.pnl >= 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{t('pnl')} {t('share' as any)}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* The card preview */}
        <div ref={cardRef} className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
          <div className="relative p-6 pb-8">
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: `linear-gradient(${isProfit ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'} 1px, transparent 1px), linear-gradient(90deg, ${isProfit ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'} 1px, transparent 1px)`,
              backgroundSize: '24px 24px',
            }} />

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">T</span>
                </div>
                <span className="text-gray-400 text-sm font-medium">Trading Bot</span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-bold text-white">{data.symbol.replace('/', '')}</h2>
                <span className={`text-xs font-semibold uppercase px-2.5 py-1 rounded-md border ${
                  data.side === 'buy'
                    ? 'bg-green-500/15 text-green-400 border-green-500/30'
                    : 'bg-red-500/15 text-red-400 border-red-500/30'
                }`}>
                  {data.side === 'buy' ? 'Long' : 'Short'}
                </span>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-gray-700/50 text-gray-400 border border-gray-600/30">
                  {data.mode}
                </span>
              </div>

              <div className="mb-6">
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">ROI</p>
                <p className={`text-5xl font-bold font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfit ? '+' : ''}{data.pnlPct.toFixed(2)}%
                </p>
                <p className={`text-lg font-mono mt-1 ${isProfit ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {isProfit ? '+' : ''}${data.pnl.toFixed(2)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{t('entryPrice')}</p>
                  <p className="text-white text-lg font-mono font-semibold">${data.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                {data.exitPrice != null && (
                  <div>
                    <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{t('exitPrice' as any)}</p>
                    <p className="text-white text-lg font-mono font-semibold">${data.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-700/50">
                <p className="text-gray-600 text-[10px] uppercase tracking-wide">{t('strategy')}: {t(data.strategy as any) || data.strategy}</p>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={captureAndShare}
          disabled={sharing}
          className="w-full mt-4 py-3 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors inline-flex items-center justify-center gap-2"
        >
          {sharing ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          )}
          {sharing ? t('loading') : t('share' as any)}
        </button>
      </div>
    </div>
  );
}
