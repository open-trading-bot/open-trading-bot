// client/src/pages/Trades.tsx
import { useEffect, useCallback, useState } from 'react';
import { getTrades, getTradeFilters, exportTrades as exportTradesApi, exportTradesCsv as exportTradesCsvApi, exportTradesTxt as exportTradesTxtApi } from '../lib/api';
import { CloseReasonBadge, CryptoIcon, useLanguageStore } from 'common';
import { downloadJson, downloadBlob, todayStamp } from '../utils/download';
import { ExportMenu } from '../components/ExportMenu';
import { SharePnlModal } from '../components/SharePnlCard';

const PAGE_SIZE = 20;

interface Trade { id: string; symbol: string; side: 'buy' | 'sell'; price: number; quantity: number; amount: number; strategy: string; mode: string; marketType: string; orderId: string; pnl: number | null; timestamp: number; testnet?: boolean; exchange?: string; closeReason?: string | null; }


type FilterState = {
  symbol: string;
  side: 'all' | 'buy' | 'sell';
  strategy: string;
  mode: 'all' | 'live' | 'paper';
  pnl: 'all' | 'profit' | 'loss';
  testnet: 'all' | 'true' | 'false';
  exchange: 'all' | 'bybit' | 'binance';
  excludeZero: boolean;
};

function buildFilters(f: FilterState) {
  const q: Record<string, any> = {};
  if (f.symbol !== 'all') q.symbol = f.symbol;
  if (f.side !== 'all') q.side = f.side;
  if (f.strategy !== 'all') q.strategy = f.strategy;
  if (f.mode !== 'all') q.mode = f.mode;
  if (f.pnl !== 'all') q.pnl = f.pnl;
  if (f.testnet !== 'all') q.testnet = f.testnet;
  if (f.exchange !== 'all') q.exchange = f.exchange;
  if (f.excludeZero) q.excludeZeroPnl = 'true';
  return Object.keys(q).length > 0 ? q : undefined;
}

export function Trades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [shareTrade, setShareTrade] = useState<Trade | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [sideFilter, setSideFilter] = useState<FilterState['side']>('all');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState<FilterState['mode']>('all');
  const [pnlFilter, setPnlFilter] = useState<FilterState['pnl']>('all');
  const [testnetFilter, setTestnetFilter] = useState<FilterState['testnet']>('all');
  const [exchangeFilter, setExchangeFilter] = useState<FilterState['exchange']>('all');
  const [excludeZeroPnl, setExcludeZeroPnl] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { t, formatDateTime, formatRelativeTime } = useLanguageStore();

  const handleExportJson = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await exportTradesApi(buildFilters(currentState()));
      downloadJson(data, `trades-${todayStamp()}.json`);
    } catch (err: any) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportTradesCsvApi(buildFilters(currentState()));
      downloadBlob(blob, `trades-${todayStamp()}.csv`);
    } catch (err: any) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportTxt = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportTradesTxtApi(buildFilters(currentState()));
      downloadBlob(blob, `trades-${todayStamp()}.txt`);
    } catch (err: any) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const [symbols, setSymbols] = useState<string[]>([]);
  const [strategies, setStrategies] = useState<string[]>([]);

  const currentState = (): FilterState => ({
    symbol: symbolFilter, side: sideFilter, strategy: strategyFilter,
    mode: modeFilter, pnl: pnlFilter, testnet: testnetFilter,
    exchange: exchangeFilter, excludeZero: excludeZeroPnl,
  });

  const fetchPage = useCallback((p: number, overrides: Partial<FilterState> = {}, sortOverride?: { sortBy: string; sortDir: 'asc' | 'desc' }) => {
    const state = { ...currentState(), ...overrides };
    const sort = sortOverride || { sortBy, sortDir };
    getTrades(p, PAGE_SIZE, buildFilters(state), sort).then((res: any) => {
      setTrades(res.data);
      setTotal(res.total);
      setPage(res.page);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolFilter, sideFilter, strategyFilter, modeFilter, pnlFilter, testnetFilter, exchangeFilter, excludeZeroPnl, sortBy, sortDir]);

  function toggleSort(column: string) {
    const newDir = sortBy === column && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(column);
    setSortDir(newDir);
    fetchPage(0, {}, { sortBy: column, sortDir: newDir });
  }

  useEffect(() => {
    fetchPage(0);
    getTradeFilters().then(({ symbols, strategies }) => { setSymbols(symbols); setStrategies(strategies); });
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const hasFilters = sideFilter !== 'all' || symbolFilter !== 'all' || strategyFilter !== 'all' || modeFilter !== 'all' || pnlFilter !== 'all' || testnetFilter !== 'all' || exchangeFilter !== 'all';

  function resetFilters() {
    setSideFilter('all');
    setSymbolFilter('all');
    setStrategyFilter('all');
    setModeFilter('all');
    setPnlFilter('all');
    setTestnetFilter('all');
    setExchangeFilter('all');
    setExcludeZeroPnl(true);
    fetchPage(0, { symbol: 'all', side: 'all', strategy: 'all', mode: 'all', pnl: 'all', testnet: 'all', exchange: 'all', excludeZero: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('tradeHistory')}</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{total} {t('trades')}</span>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 text-xs">
            {(['all', 'buy', 'sell'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setSideFilter(f); fetchPage(0, { side: f }); }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${sideFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {f !== 'all' && <span className={`inline-block w-2 h-2 rounded-full me-1.5 ${f === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />}{f === 'buy' ? t('buy') : f === 'sell' ? t('sell') : t('all')}
              </button>
            ))}
          </div>

          <select
            value={symbolFilter}
            onChange={(e) => { setSymbolFilter(e.target.value); fetchPage(0, { symbol: e.target.value }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allSymbols')}</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={strategyFilter}
            onChange={(e) => { setStrategyFilter(e.target.value); fetchPage(0, { strategy: e.target.value }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allStrategies')}</option>
            {strategies.map((s) => <option key={s} value={s}>{t(s as any) || s}</option>)}
          </select>

          <select
            value={modeFilter}
            onChange={(e) => { const v = e.target.value as FilterState['mode']; setModeFilter(v); fetchPage(0, { mode: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allModes')}</option>
            <option value="paper">{t('paper')}</option>
            <option value="live">{t('live')}</option>
          </select>

          <select
            value={exchangeFilter}
            onChange={(e) => { const v = e.target.value as FilterState['exchange']; setExchangeFilter(v); fetchPage(0, { exchange: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allExchanges')}</option>
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
          </select>

          <select
            value={testnetFilter}
            onChange={(e) => { const v = e.target.value as FilterState['testnet']; setTestnetFilter(v); fetchPage(0, { testnet: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allNetworks')}</option>
            <option value="true">{t('testnet')}</option>
            <option value="false">{t('mainnet')}</option>
          </select>

          <select
            value={pnlFilter}
            onChange={(e) => { const v = e.target.value as FilterState['pnl']; setPnlFilter(v); fetchPage(0, { pnl: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allPnl')}</option>
            <option value="profit">{t('profitOnly')}</option>
            <option value="loss">{t('lossOnly')}</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={excludeZeroPnl} onChange={(e) => { setExcludeZeroPnl(e.target.checked); fetchPage(0, { excludeZero: e.target.checked }); }} className="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 w-3.5 h-3.5" />
            {t('hideZeroPnl')}
          </label>

          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
              {t('clear')}
            </button>
          )}
          </div>

          <ExportMenu
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            onExportTxt={handleExportTxt}
            disabled={trades.length === 0}
            busy={exporting}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <div className="relative mb-3 animate-float">
              <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
              <div className="absolute inset-0 rounded-full bg-gray-500/10 animate-pulse-ring" />
            </div>
            <p className="text-sm">{trades.length === 0 ? t('noTradesYet') : t('noTradesMatch')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                    {([
                      { key: 'timestamp', label: t('time'), align: 'text-start' },
                      { key: 'symbol', label: t('asset'), align: 'text-start' },
                      { key: 'side', label: t('side'), align: 'text-start' },
                      { key: 'price', label: t('price'), align: 'text-end' },
                      { key: 'amount', label: t('amount'), align: 'text-end' },
                      { key: 'pnl', label: t('pnl'), align: 'text-end' },
                      { key: 'strategy', label: t('strategy'), align: 'text-start' },
                      { key: null, label: t('mode'), align: 'text-start' },
                      { key: null, label: t('exchange'), align: 'text-start' },
                      { key: null, label: t('network'), align: 'text-start' },
                      { key: null, label: t('closedBy'), align: 'text-start' },
                    ] as const).map(({ key, label, align }, i) => (
                      <th
                        key={i}
                        className={`${align} py-3 px-4 ${key ? 'cursor-pointer select-none hover:text-gray-300 transition-colors' : ''}`}
                        onClick={key ? () => toggleSort(key) : undefined}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {key && sortBy === key && (
                            <span className="text-blue-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr) => (
                    <tr key={tr.id} onClick={() => setSelectedTrade(tr)} className="border-b border-gray-800/30 cursor-pointer hover:bg-gray-800/30 transition-colors">
                      <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap" title={formatDateTime(tr.timestamp)}>{formatRelativeTime(tr.timestamp)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <CryptoIcon symbol={tr.symbol} size={18} />
                          <span className="font-medium">{tr.symbol}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${tr.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          {t(tr.side as 'buy' | 'sell')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-mono">${tr.price.toFixed(2)}</td>
                      <td className="py-3 px-4 text-end font-mono text-gray-300">${tr.amount.toFixed(2)}</td>
                      <td className={`py-3 px-4 text-end font-mono font-semibold ${(tr.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tr.pnl !== null ? `$${tr.pnl.toFixed(2)}` : <span className="text-gray-600">--</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{t(tr.strategy as any) || tr.strategy}</td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${tr.mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                          {t(tr.mode as any)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {tr.mode === 'live' && tr.exchange ? (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                            {tr.exchange}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {tr.mode === 'live' ? (
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${tr.testnet ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'}`}>
                            {tr.testnet ? t('testnet') : t('mainnet')}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <CloseReasonBadge reason={tr.closeReason} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-800/50">
                <button
                  onClick={() => fetchPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('prev')}
                </button>
                <span className="text-xs text-gray-500 font-mono">{page + 1} / {totalPages}</span>
                <button
                  onClick={() => fetchPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page === totalPages - 1}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('next')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Trade Detail Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedTrade(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedTrade.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedTrade.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedTrade.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedTrade.side}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {selectedTrade.pnl !== null && (
                  <button onClick={() => { setShareTrade(selectedTrade); setSelectedTrade(null); }} className="text-gray-500 hover:text-blue-400 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  </button>
                )}
                <button onClick={() => setSelectedTrade(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('price')}</div>
                  <div className="font-mono font-semibold truncate">${selectedTrade.price.toLocaleString()}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('quantity')}</div>
                  <div className="font-mono font-semibold truncate">{selectedTrade.quantity < 1 ? selectedTrade.quantity.toPrecision(4) : selectedTrade.quantity.toFixed(4)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('amount')}</div>
                  <div className="font-mono font-semibold truncate">${selectedTrade.amount.toFixed(2)}</div>
                </div>
                <div className={`rounded-xl p-3 border ${(selectedTrade.pnl ?? 0) >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('pnl')}</div>
                  <div className={`font-mono font-semibold ${(selectedTrade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedTrade.pnl !== null ? `$${selectedTrade.pnl.toFixed(2)}` : '--'}
                  </div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('strategy')}</div>
                  <div className="font-medium text-sm">{t(selectedTrade.strategy as any) || selectedTrade.strategy}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('mode')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedTrade.mode as any)}</div>
                </div>
                {selectedTrade.mode === 'live' && (
                  <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('exchange')}</div>
                    <div className="font-medium text-sm capitalize">
                      {selectedTrade.exchange || '—'}
                      {selectedTrade.testnet && (
                        <span className="ms-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                          {t('testnet')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('marketType')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedTrade.marketType as any)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('orderId')}</div>
                  <button
                    type="button"
                    title={copiedOrderId === selectedTrade.orderId ? t('orderIdCopied') : t('copyOrderId')}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedTrade.orderId).catch(() => {});
                      setCopiedOrderId(selectedTrade.orderId);
                      setTimeout(() => setCopiedOrderId((cur) => (cur === selectedTrade.orderId ? null : cur)), 1500);
                    }}
                    className="font-mono text-xs truncate text-start hover:text-blue-400 transition-colors w-full"
                  >
                    {copiedOrderId === selectedTrade.orderId ? t('orderIdCopied') : selectedTrade.orderId}
                  </button>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('timestamp')}</div>
                <div className="font-mono text-sm">{formatDateTime(selectedTrade.timestamp)}</div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('tradeId')}</div>
                <div className="font-mono text-xs">{selectedTrade.id}</div>
              </div>

            </div>
          </div>
        </div>
      )}

      {shareTrade && shareTrade.pnl !== null && (
        <SharePnlModal
          data={{
            symbol: shareTrade.symbol,
            side: shareTrade.side,
            pnl: shareTrade.pnl,
            pnlPct: shareTrade.amount > 0 ? (shareTrade.pnl / shareTrade.amount) * 100 : 0,
            entryPrice: shareTrade.quantity > 0 ? shareTrade.price - shareTrade.pnl / shareTrade.quantity : shareTrade.price,
            exitPrice: shareTrade.price,
            strategy: shareTrade.strategy,
            mode: shareTrade.mode,
          }}
          onClose={() => setShareTrade(null)}
        />
      )}
    </div>
  );
}
