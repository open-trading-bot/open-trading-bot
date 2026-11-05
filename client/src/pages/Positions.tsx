// client/src/pages/Positions.tsx
import { useEffect, useMemo, useCallback, useState } from 'react';
import { getPositions, getTrades, getTradeFilters, closePosition, exportPositions as exportPositionsApi, exportTrades as exportTradesApi, exportPositionsCsv as exportPositionsCsvApi, exportTradesCsv as exportTradesCsvApi, exportPositionsTxt as exportPositionsTxtApi, exportTradesTxt as exportTradesTxtApi } from '../lib/api';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '../stores/bot';
import { CloseReasonBadge, CryptoIcon, useLanguageStore } from 'common';
import { downloadJson, downloadBlob, todayStamp } from '../utils/download';
import { ExportMenu } from '../components/ExportMenu';
import { SharePnlModal } from '../components/SharePnlCard';

const PAGE_SIZE = 20;

type SideFilter = 'all' | 'buy' | 'sell';
type PnlFilter = 'all' | 'profit' | 'loss';
type ModeFilter = 'all' | 'live' | 'paper';
type TestnetFilter = 'all' | 'true' | 'false';
type ExchangeFilter = 'all' | 'bybit' | 'binance';

type FilterState = {
  symbol: string;
  side: SideFilter;
  strategy: string;
  mode: ModeFilter;
  pnl: PnlFilter;
  testnet: TestnetFilter;
  exchange: ExchangeFilter;
  excludeZero: boolean;
};

interface OpenPosition {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  quantity: number;
  amount: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  strategy: string;
  mode: string;
  marketType: string;
  stopLoss: number | null;
  openedAt: number;
  testnet?: boolean;
  exchange?: string;
}

interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  amount: number;
  strategy: string;
  mode: string;
  marketType: string;
  orderId: string;
  pnl: number | null;
  timestamp: number;
  testnet?: boolean;
  exchange?: string;
  closeReason?: string | null;
}

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

function formatDuration(ms: number, t: (k: any) => string): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${t('days')}`);
  if (hours > 0) parts.push(`${hours} ${t('hours')}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${t('minutes')}`);
  return parts.join(', ');
}

export function Positions() {
  const { positions, setPositions } = useBotStore(useShallow((s) => ({ positions: s.positions, setPositions: s.setPositions })));
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [openPage, setOpenPage] = useState(0);
  const [closedPage, setClosedPage] = useState(0);
  const [selectedPosition, setSelectedPosition] = useState<OpenPosition | null>(null);
  const [selectedClosed, setSelectedClosed] = useState<Trade | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<SideFilter>('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [testnetFilter, setTestnetFilter] = useState<TestnetFilter>('all');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('all');
  const [excludeZeroPnl, setExcludeZeroPnl] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<OpenPosition | null>(null);
  const [exporting, setExporting] = useState(false);
  const [shareData, setShareData] = useState<{ symbol: string; side: 'buy' | 'sell'; pnl: number; pnlPct: number; entryPrice: number; exitPrice?: number; strategy: string; mode: string } | null>(null);
  const [openSortBy, setOpenSortBy] = useState('openedAt');
  const [openSortDir, setOpenSortDir] = useState<'asc' | 'desc'>('desc');
  const [closedSortBy, setClosedSortBy] = useState('timestamp');
  const [closedSortDir, setClosedSortDir] = useState<'asc' | 'desc'>('desc');
  const { t, formatDateTime } = useLanguageStore();

  const handleExportJson = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      if (tab === 'open') {
        const all = await exportPositionsApi();
        const filtered = applyFilters(all as any);
        downloadJson(filtered, `open-positions-${todayStamp()}.json`);
      } else {
        const data = await exportTradesApi(buildFilters(currentState()));
        downloadJson(data, `closed-trades-${todayStamp()}.json`);
      }
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
      if (tab === 'open') {
        // Server streams every open position; client-side filters are not
        // applied here because the CSV path is pure blob → download. For
        // filter-respecting CSV on open positions, users can use the filtered
        // JSON export. Keeping parity with Trades: CSV = full server stream.
        const blob = await exportPositionsCsvApi();
        downloadBlob(blob, `open-positions-${todayStamp()}.csv`);
      } else {
        const blob = await exportTradesCsvApi(buildFilters(currentState()));
        downloadBlob(blob, `closed-trades-${todayStamp()}.csv`);
      }
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
      if (tab === 'open') {
        // Same streaming-vs-filter tradeoff as CSV above.
        const blob = await exportPositionsTxtApi();
        downloadBlob(blob, `open-positions-${todayStamp()}.txt`);
      } else {
        const blob = await exportTradesTxtApi(buildFilters(currentState()));
        downloadBlob(blob, `closed-trades-${todayStamp()}.txt`);
      }
    } catch (err: any) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const performClose = async (positionId: string) => {
    setClosing(positionId);
    setCloseTarget(null);
    try {
      await closePosition(positionId);
    } catch (err: any) {
      alert(err?.message || t('close') + ' failed');
    } finally {
      setClosing(null);
    }
  };

  const currentState = (): FilterState => ({
    symbol: symbolFilter, side: sideFilter, strategy: strategyFilter,
    mode: modeFilter, pnl: pnlFilter, testnet: testnetFilter,
    exchange: exchangeFilter, excludeZero: excludeZeroPnl,
  });

  const fetchClosedPage = useCallback((p: number, overrides: Partial<FilterState> = {}, sortOverride?: { sortBy: string; sortDir: 'asc' | 'desc' }) => {
    const state = { ...currentState(), ...overrides };
    const sort = sortOverride || { sortBy: closedSortBy, sortDir: closedSortDir };
    getTrades(p, PAGE_SIZE, buildFilters(state), sort).then((res: any) => {
      setClosedTrades(res.data.filter((tr: any) => tr.pnl !== null));
      setClosedTotal(res.total);
      setClosedPage(res.page);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolFilter, sideFilter, strategyFilter, modeFilter, pnlFilter, testnetFilter, exchangeFilter, excludeZeroPnl, closedSortBy, closedSortDir]);

  function toggleClosedSort(column: string) {
    const newDir = closedSortBy === column && closedSortDir === 'desc' ? 'asc' : 'desc';
    setClosedSortBy(column);
    setClosedSortDir(newDir);
    fetchClosedPage(0, {}, { sortBy: column, sortDir: newDir });
  }

  useEffect(() => {
    getPositions(0, 100).then((r) => setPositions(r.data));
    fetchClosedPage(0);
    getTradeFilters().then(({ symbols, strategies }) => { setAllSymbols(symbols); setAllStrategies(strategies); });
  }, []);

  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [allStrategies, setAllStrategies] = useState<string[]>([]);

  function applyFilters<T extends { symbol: string; side: string; strategy: string; pnl: number }>(items: T[]): T[] {
    return items.filter((item) => {
      if (symbolFilter !== 'all' && item.symbol !== symbolFilter) return false;
      if (sideFilter !== 'all' && item.side !== sideFilter) return false;
      if (strategyFilter !== 'all' && item.strategy !== strategyFilter) return false;
      if (pnlFilter === 'profit' && item.pnl < 0) return false;
      if (pnlFilter === 'loss' && item.pnl >= 0) return false;
      if (modeFilter !== 'all' && (item as any).mode !== modeFilter) return false;
      // Network filter only applies to live positions — paper has no network.
      if (testnetFilter === 'true' && ((item as any).mode !== 'live' || !(item as any).testnet)) return false;
      if (testnetFilter === 'false' && ((item as any).mode !== 'live' || (item as any).testnet)) return false;
      if (exchangeFilter !== 'all' && (item as any).exchange !== exchangeFilter) return false;
      return true;
    });
  }

  const filteredOpen = useMemo(() => {
    const filtered = applyFilters(positions as (OpenPosition & { pnl: number })[]);
    const col = openSortBy as keyof OpenPosition;
    return [...filtered].sort((a, b) => {
      const av = (a as any)[col] ?? 0;
      const bv = (b as any)[col] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return openSortDir === 'asc' ? cmp : -cmp;
    });
  }, [positions, symbolFilter, sideFilter, strategyFilter, pnlFilter, modeFilter, testnetFilter, exchangeFilter, openSortBy, openSortDir]);

  function toggleOpenSort(column: string) {
    const newDir = openSortBy === column && openSortDir === 'desc' ? 'asc' : 'desc';
    setOpenSortBy(column);
    setOpenSortDir(newDir);
    setOpenPage(0);
  }

  const openTotalPages = Math.ceil(filteredOpen.length / PAGE_SIZE);
  const openSafePage = Math.min(openPage, Math.max(0, openTotalPages - 1));
  const paginatedOpen = filteredOpen.slice(openSafePage * PAGE_SIZE, (openSafePage + 1) * PAGE_SIZE);

  const closedTotalPages = Math.ceil(closedTotal / PAGE_SIZE);

  const hasActiveFilter = symbolFilter !== 'all' || sideFilter !== 'all' || strategyFilter !== 'all' || pnlFilter !== 'all' || modeFilter !== 'all' || testnetFilter !== 'all' || exchangeFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('positions')}</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{filteredOpen.length + closedTotal} {t('total')}</span>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800/50 w-fit">
        <button
          onClick={() => { setTab('open'); setOpenPage(0); }}
          className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${tab === 'open' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:text-white'}`}
        >
          {t('open')} <span className="ml-1 text-xs">({filteredOpen.length})</span>
        </button>
        <button
          onClick={() => { setTab('closed'); setClosedPage(0); }}
          className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${tab === 'closed' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:text-white'}`}
        >
          {t('closed')} <span className="ml-1 text-xs">({closedTotal})</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 text-xs">
            {(['all', 'buy', 'sell'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setSideFilter(f); setOpenPage(0); fetchClosedPage(0, { side: f }); }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${sideFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {f !== 'all' && <span className={`inline-block w-2 h-2 rounded-full me-1.5 ${f === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />}{f === 'buy' ? t('buy') : f === 'sell' ? t('sell') : t('all')}
              </button>
            ))}
          </div>

          <select
            value={symbolFilter}
            onChange={(e) => { setSymbolFilter(e.target.value); setOpenPage(0); fetchClosedPage(0, { symbol: e.target.value }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allSymbols')}</option>
            {allSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={strategyFilter}
            onChange={(e) => { setStrategyFilter(e.target.value); setOpenPage(0); fetchClosedPage(0, { strategy: e.target.value }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allStrategies')}</option>
            {allStrategies.map((s) => <option key={s} value={s}>{t(s as any) || s}</option>)}
          </select>

          <select
            value={pnlFilter}
            onChange={(e) => { const v = e.target.value as PnlFilter; setPnlFilter(v); setOpenPage(0); fetchClosedPage(0, { pnl: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allPnl')}</option>
            <option value="profit">{t('profitOnly')}</option>
            <option value="loss">{t('lossOnly')}</option>
          </select>

          <select
            value={modeFilter}
            onChange={(e) => { const v = e.target.value as ModeFilter; setModeFilter(v); setOpenPage(0); fetchClosedPage(0, { mode: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allModes')}</option>
            <option value="paper">{t('paper')}</option>
            <option value="live">{t('live')}</option>
          </select>

          <select
            value={exchangeFilter}
            onChange={(e) => { const v = e.target.value as ExchangeFilter; setExchangeFilter(v); setOpenPage(0); fetchClosedPage(0, { exchange: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allExchanges')}</option>
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
          </select>

          <select
            value={testnetFilter}
            onChange={(e) => { const v = e.target.value as TestnetFilter; setTestnetFilter(v); setOpenPage(0); fetchClosedPage(0, { testnet: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">{t('allNetworks')}</option>
            <option value="true">{t('testnet')}</option>
            <option value="false">{t('mainnet')}</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={excludeZeroPnl} onChange={(e) => { setExcludeZeroPnl(e.target.checked); fetchClosedPage(0, { excludeZero: e.target.checked }); }} className="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 w-3.5 h-3.5" />
            {t('hideZeroPnl')}
          </label>

          {hasActiveFilter && (
            <button
              onClick={() => {
                setSymbolFilter('all'); setSideFilter('all'); setStrategyFilter('all');
                setPnlFilter('all'); setModeFilter('all'); setTestnetFilter('all');
                setExchangeFilter('all'); setExcludeZeroPnl(true); setOpenPage(0);
                fetchClosedPage(0, { symbol: 'all', side: 'all', strategy: 'all', pnl: 'all', mode: 'all', testnet: 'all', exchange: 'all', excludeZero: true });
              }}
              className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              {t('clearFilters')}
            </button>
          )}
          </div>

          <ExportMenu
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            onExportTxt={handleExportTxt}
            disabled={tab === 'open' ? filteredOpen.length === 0 : closedTotal === 0}
            busy={exporting}
          />
        </div>
      </div>

      {tab === 'open' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          {positions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <div className="relative mb-3 animate-float">
                <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <div className="absolute inset-0 rounded-full bg-gray-500/10 animate-pulse-ring" />
              </div>
              <p className="text-sm">{t('noOpenPositions')}</p>
            </div>
          ) : (
            <>
              <div key={openSafePage} className="overflow-x-auto animate-page-fade">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                      {([
                        { key: 'symbol', label: t('asset'), align: 'text-start' },
                        { key: 'side', label: t('side'), align: 'text-start' },
                        { key: 'entryPrice', label: t('entry'), align: 'text-end' },
                        { key: 'currentPrice', label: t('current'), align: 'text-end' },
                        { key: 'pnlPct', label: t('pnl'), align: 'text-end' },
                        { key: 'strategy', label: t('strategy'), align: 'text-start' },
                        { key: null, label: t('mode'), align: 'text-start' },
                        { key: null, label: t('exchange'), align: 'text-start' },
                        { key: null, label: t('network'), align: 'text-start' },
                      ] as const).map(({ key, label, align }, i) => (
                        <th
                          key={i}
                          className={`${align} py-3 px-4 ${key ? 'cursor-pointer select-none hover:text-gray-300 transition-colors' : ''}`}
                          onClick={key ? () => toggleOpenSort(key) : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {key && openSortBy === key && (
                              <span className="text-blue-400">{openSortDir === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOpen.map((p) => (
                      <tr key={p.id} onClick={() => setSelectedPosition(p as OpenPosition)} className="group border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <CryptoIcon symbol={p.symbol} size={20} />
                            <span className="font-medium">{p.symbol}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${p.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {t(p.side as 'buy' | 'sell')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-end font-mono text-gray-300">${p.entryPrice.toFixed(2)}</td>
                        <td className="py-3 px-4 text-end font-mono">${p.currentPrice.toFixed(2)}</td>
                        <td className="py-3 px-4 text-end">
                          <div className={`font-mono font-semibold ${p.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
                          </div>
                          <div className={`text-xs font-mono ${p.pnl >= 0 ? 'text-green-400/50' : 'text-red-400/50'}`}>
                            ${p.pnl.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{t(p.strategy as any) || p.strategy}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${(p as any).mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                            {t((p as any).mode || 'paper')}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {(p as any).mode === 'live' && (p as any).exchange ? (
                            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                              {(p as any).exchange}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {(p as any).mode === 'live' ? (
                            <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${(p as any).testnet ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'}`}>
                              {(p as any).testnet ? t('testnet') : t('mainnet')}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {openTotalPages > 1 && (
                <Pagination page={openSafePage} totalPages={openTotalPages} onPageChange={setOpenPage} t={t} />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'closed' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          {closedTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <div className="relative mb-3 animate-float">
                <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
                <div className="absolute inset-0 rounded-full bg-gray-500/10 animate-pulse-ring" />
              </div>
              <p className="text-sm">{t('noClosedTrades')}</p>
            </div>
          ) : (
            <>
              <div key={closedPage} className="overflow-x-auto animate-page-fade">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                      {([
                        { key: 'symbol', label: t('asset'), align: 'text-start' },
                        { key: 'side', label: t('side'), align: 'text-start' },
                        { key: 'price', label: t('price'), align: 'text-end' },
                        { key: 'pnl', label: t('pnl'), align: 'text-end' },
                        { key: 'strategy', label: t('strategy'), align: 'text-start' },
                        { key: null, label: t('mode'), align: 'text-start' },
                        { key: null, label: t('exchange'), align: 'text-start' },
                        { key: null, label: t('network'), align: 'text-start' },
                        { key: null, label: t('closedBy'), align: 'text-start' },
                        { key: 'timestamp', label: t('time'), align: 'text-start' },
                      ] as const).map(({ key, label, align }, i) => (
                        <th
                          key={i}
                          className={`${align} py-3 px-4 ${key ? 'cursor-pointer select-none hover:text-gray-300 transition-colors' : ''}`}
                          onClick={key ? () => toggleClosedSort(key) : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {key && closedSortBy === key && (
                              <span className="text-blue-400">{closedSortDir === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closedTrades.map((tr: any) => (
                      <tr key={tr.id} onClick={() => setSelectedClosed(tr)} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <CryptoIcon symbol={tr.symbol} size={20} />
                            <span className="font-medium">{tr.symbol}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${tr.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {t(tr.side)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-end font-mono">${tr.price.toFixed(2)}</td>
                        <td className={`py-3 px-4 text-end font-mono font-semibold ${(tr.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${(tr.pnl ?? 0).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{t(tr.strategy as any) || tr.strategy}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${tr.mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                            {t(tr.mode || 'paper')}
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
                          <CloseReasonBadge reason={(tr as any).closeReason} t={t} />
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{formatDateTime(tr.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {closedTotalPages > 1 && (
                <Pagination page={closedPage} totalPages={closedTotalPages} onPageChange={(v: any) => fetchClosedPage(typeof v === 'function' ? v(closedPage) : v)} t={t} />
              )}
            </>
          )}
        </div>
      )}

      {/* Open Position Detail Modal */}
      {selectedPosition && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedPosition(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedPosition.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedPosition.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedPosition.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {t(selectedPosition.side as any)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => {
                  setShareData({
                    symbol: selectedPosition.symbol,
                    side: selectedPosition.side as 'buy' | 'sell',
                    pnl: selectedPosition.pnl,
                    pnlPct: selectedPosition.pnlPct,
                    entryPrice: selectedPosition.entryPrice,
                    exitPrice: selectedPosition.currentPrice,
                    strategy: selectedPosition.strategy,
                    mode: (selectedPosition as any).mode || 'paper',
                  });
                  setSelectedPosition(null);
                }} className="text-gray-500 hover:text-blue-400 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                </button>
                <button onClick={() => setSelectedPosition(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* P&L Banner */}
            <div className={`rounded-xl p-4 mb-4 border ${selectedPosition.pnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">{t('pnl')}</div>
                  <div className={`text-2xl font-mono font-bold ${selectedPosition.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedPosition.pnl >= 0 ? '+' : ''}${selectedPosition.pnl.toFixed(2)}
                  </div>
                </div>
                <div className={`text-xl font-mono font-bold ${selectedPosition.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {selectedPosition.pnlPct >= 0 ? '+' : ''}{selectedPosition.pnlPct.toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('entryPrice')}</div>
                  <div className="font-mono font-semibold">${selectedPosition.entryPrice.toLocaleString()}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('currentPrice')}</div>
                  <div className="font-mono font-semibold">${selectedPosition.currentPrice.toLocaleString()}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('quantity')}</div>
                  <div className="font-mono font-semibold">{selectedPosition.quantity < 1 ? selectedPosition.quantity.toPrecision(4) : selectedPosition.quantity.toFixed(4)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('positionSize')}</div>
                  <div className="font-mono font-semibold">${selectedPosition.amount.toFixed(2)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('stopLossPrice')}</div>
                  <div className="font-mono font-semibold">{selectedPosition.stopLoss !== null ? `$${selectedPosition.stopLoss.toLocaleString()}` : '--'}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('strategy')}</div>
                  <div className="font-medium text-sm">{t(selectedPosition.strategy as any) || selectedPosition.strategy}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('marketType')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedPosition.marketType as any)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('holdDuration')}</div>
                  <div className="font-medium text-sm">{formatDuration(Date.now() - selectedPosition.openedAt, t)}</div>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('openedAt')}</div>
                <div className="font-mono text-sm">{formatDateTime(selectedPosition.openedAt)}</div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('positionId')}</div>
                <div className="font-mono text-xs">{selectedPosition.id}</div>
              </div>

              <button
                onClick={() => { setCloseTarget(selectedPosition); setSelectedPosition(null); }}
                disabled={closing === selectedPosition.id}
                className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {closing === selectedPosition.id ? t('closing') : `${t('close')} ${selectedPosition.symbol}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Closed Trade Detail Modal */}
      {selectedClosed && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedClosed(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedClosed.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedClosed.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedClosed.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {t(selectedClosed.side as any)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {selectedClosed.pnl !== null && (
                  <button onClick={() => {
                    setShareData({
                      symbol: selectedClosed.symbol,
                      side: selectedClosed.side,
                      pnl: selectedClosed.pnl!,
                      pnlPct: selectedClosed.amount > 0 ? (selectedClosed.pnl! / selectedClosed.amount) * 100 : 0,
                      entryPrice: selectedClosed.quantity > 0 ? selectedClosed.price - selectedClosed.pnl! / selectedClosed.quantity : selectedClosed.price,
                      exitPrice: selectedClosed.price,
                      strategy: selectedClosed.strategy,
                      mode: selectedClosed.mode,
                    });
                    setSelectedClosed(null);
                  }} className="text-gray-500 hover:text-blue-400 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  </button>
                )}
                <button onClick={() => setSelectedClosed(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('price')}</div>
                  <div className="font-mono font-semibold">${selectedClosed.price.toLocaleString()}</div>
                </div>
                <div className={`rounded-xl p-3 border ${(selectedClosed.pnl ?? 0) >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('pnl')}</div>
                  <div className={`font-mono font-semibold ${(selectedClosed.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${(selectedClosed.pnl ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('quantity')}</div>
                  <div className="font-mono font-semibold">{selectedClosed.quantity < 1 ? selectedClosed.quantity.toPrecision(4) : selectedClosed.quantity.toFixed(4)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('amount')}</div>
                  <div className="font-mono font-semibold">${selectedClosed.amount.toFixed(2)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('strategy')}</div>
                  <div className="font-medium text-sm">{t(selectedClosed.strategy as any) || selectedClosed.strategy}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('mode')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedClosed.mode as any)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('marketType')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedClosed.marketType as any)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('orderId')}</div>
                  <div className="font-mono text-xs truncate">{selectedClosed.orderId}</div>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('timestamp')}</div>
                <div className="font-mono text-sm">{formatDateTime(selectedClosed.timestamp)}</div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('tradeId')}</div>
                <div className="font-mono text-xs">{selectedClosed.id}</div>
              </div>

            </div>
          </div>
        </div>
      )}

      {shareData && (
        <SharePnlModal data={shareData} onClose={() => setShareData(null)} />
      )}

      {/* Confirm Close Modal */}
      {closeTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setCloseTarget(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <CryptoIcon symbol={closeTarget.symbol} size={36} />
              <div>
                <h3 className="text-lg font-semibold">
                  {(t('confirmClosePosition') || 'Close {symbol}?').replace('{symbol}', closeTarget.symbol)}
                </h3>
                <span className={`text-xs font-semibold uppercase ${closeTarget.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                  {t(closeTarget.side as any)}
                </span>
              </div>
            </div>

            <div className={`rounded-xl p-4 mb-5 border ${closeTarget.pnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('estimatedPnl') || 'Estimated P&L'}</div>
              <div className="flex items-baseline justify-between">
                <div className={`text-2xl font-mono font-bold ${closeTarget.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {closeTarget.pnl >= 0 ? '+' : '−'}${Math.abs(closeTarget.pnl).toFixed(2)}
                </div>
                <div className={`text-lg font-mono font-bold ${closeTarget.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {closeTarget.pnlPct >= 0 ? '+' : '−'}{Math.abs(closeTarget.pnlPct).toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-5">
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('entry')}</div>
                <div className="font-mono font-semibold text-sm">${closeTarget.entryPrice.toLocaleString()}</div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('current')}</div>
                <div className="font-mono font-semibold text-sm">${closeTarget.currentPrice.toLocaleString()}</div>
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setCloseTarget(null)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => performClose(closeTarget.id)}
                disabled={closing === closeTarget.id}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {closing === closeTarget.id ? t('closing') : t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onPageChange, t }: { page: number; totalPages: number; onPageChange: (p: number | ((p: number) => number)) => void; t: (k: any) => string }) {
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
