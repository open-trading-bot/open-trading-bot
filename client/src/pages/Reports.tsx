import { useEffect, useState } from 'react';
import { useLanguageStore, Pagination } from 'common';
import { getDailyPnlReport } from '../lib/api';
import { downloadBlob, todayStamp } from '../utils/download';

interface DailyRow {
  date: string;
  pnl: number;
  tradeCount: number;
  volume: number;
  balance: number | null;
}

const PAGE_SIZE = 20;

function formatDateLocale(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatBalance(balance: number | null | undefined): string {
  if (balance == null) return '—';
  return `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Reports() {
  const { t } = useLanguageStore();
  const [data, setData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    getDailyPnlReport()
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  const totalPnl = data.reduce((sum, r) => sum + r.pnl, 0);
  const totalTrades = data.reduce((sum, r) => sum + r.tradeCount, 0);
  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = data.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const totalVolume = data.reduce((sum, r) => sum + r.volume, 0);
  const totalPct = totalVolume > 0 ? (totalPnl / totalVolume) * 100 : 0;

  function exportCsv() {
    const header = 'Date,P&L,P&L %,Balance,Trades\n';
    const rows = data.map((r) => {
      const pct = r.volume > 0 ? ((r.pnl / r.volume) * 100).toFixed(2) : '0.00';
      const balance = r.balance == null ? '' : r.balance.toFixed(2);
      return `${formatDateLocale(r.date)},${r.pnl.toFixed(2)},${pct}%,${balance},${r.tradeCount}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    downloadBlob(blob, `daily-pnl-${todayStamp()}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('reports')}</h2>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <h3 className="text-sm font-medium text-gray-400">{t('dailyPnlReport')}</h3>
          <button
            onClick={exportCsv}
            disabled={data.length === 0}
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('exportCsv')}
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500">{t('loading')}…</div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-gray-500">{t('noReportData')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-5 pt-4">
              <div className={`rounded-xl p-3 border ${totalPnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('totalPnlLabel')}</div>
                <div className={`text-xl font-mono font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                </div>
                <div className={`text-xs font-mono ${totalPct >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                  {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%
                </div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('tradeCount')}</div>
                <div className="text-xl font-mono font-bold">{totalTrades}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                    <th className="text-start py-3 px-4">{t('date')}</th>
                    <th className="text-end py-3 px-4">{t('pnl')}</th>
                    <th className="text-end py-3 px-4">%</th>
                    <th className="text-end py-3 px-4">{t('balance')}</th>
                    <th className="text-end py-3 px-4">{t('tradeCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row) => {
                    const pct = row.volume > 0 ? (row.pnl / row.volume) * 100 : 0;
                    return (
                      <tr key={row.date} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                        <td className="py-3 px-4 font-mono text-gray-300">{formatDateLocale(row.date)}</td>
                        <td className={`py-3 px-4 text-end font-mono font-semibold ${row.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {row.pnl >= 0 ? '+' : ''}${row.pnl.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-end font-mono text-xs ${pct >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </td>
                        <td className={`py-3 px-4 text-end font-mono ${row.balance == null ? 'text-gray-600' : 'text-gray-300'}`}>
                          {formatBalance(row.balance)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono text-gray-400">{row.tradeCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
