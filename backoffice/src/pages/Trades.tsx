import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLanguageStore, EmptyState, CryptoIcon, Pagination } from 'common';
import { getAllTrades, getAllTradeFilters, getUsers } from '../lib/api';

const PAGE_SIZE = 20;

interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  pnl?: number;
  strategy: string;
  mode: string;
  testnet: boolean;
  exchange?: string;
  timestamp: number;
  userId: number;
}

interface User {
  id: number;
  username: string;
}

type FilterState = {
  symbol: string;
  side: 'all' | 'buy' | 'sell';
  strategy: string;
  mode: 'all' | 'live' | 'paper';
  userId: number | '';
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
  if (f.userId !== '') q.userId = f.userId;
  if (f.pnl !== 'all') q.pnl = f.pnl;
  if (f.testnet !== 'all') q.testnet = f.testnet;
  if (f.exchange !== 'all') q.exchange = f.exchange;
  if (f.excludeZero) q.excludeZeroPnl = 'true';
  return Object.keys(q).length > 0 ? q : undefined;
}

export function Trades() {
  const { t, formatDateTime } = useLanguageStore();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [userFilter, setUserFilter] = useState<FilterState['userId']>('');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<FilterState['side']>('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState<FilterState['mode']>('all');
  const [pnlFilter, setPnlFilter] = useState<FilterState['pnl']>('all');
  const [testnetFilter, setTestnetFilter] = useState<FilterState['testnet']>('all');
  const [exchangeFilter, setExchangeFilter] = useState<FilterState['exchange']>('all');
  const [excludeZeroPnl, setExcludeZeroPnl] = useState(true);
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [strategies, setStrategies] = useState<string[]>([]);

  const currentState = (): FilterState => ({
    symbol: symbolFilter, side: sideFilter, strategy: strategyFilter,
    mode: modeFilter, userId: userFilter, pnl: pnlFilter,
    testnet: testnetFilter, exchange: exchangeFilter, excludeZero: excludeZeroPnl,
  });

  const fetchPage = useCallback((p: number, overrides: Partial<FilterState> = {}, sortOverride?: { sortBy: string; sortDir: string }) => {
    const state = { ...currentState(), ...overrides };
    const sort = sortOverride || { sortBy, sortDir };
    const filters = { ...buildFilters(state), ...sort };
    getAllTrades(p, PAGE_SIZE, filters).then((res: any) => {
      setTrades(res.data || []);
      setTotal(res.total || 0);
      setPage(res.page || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolFilter, sideFilter, strategyFilter, modeFilter, userFilter, pnlFilter, excludeZeroPnl, testnetFilter, exchangeFilter, sortBy, sortDir]);

  function toggleSort(column: string) {
    const newDir = sortBy === column && sortDir === 'desc' ? 'asc' : 'desc';
    setSortBy(column);
    setSortDir(newDir);
    fetchPage(0, {}, { sortBy: column, sortDir: newDir });
  }

  useEffect(() => {
    const initial: FilterState = {
      symbol: 'all', side: 'all', strategy: 'all', mode: 'all', userId: '',
      pnl: 'all', testnet: 'all', exchange: 'all', excludeZero: true,
    };
    Promise.all([
      getAllTrades(0, PAGE_SIZE, buildFilters(initial)).catch(() => ({ data: [], total: 0, page: 0 })),
      getUsers().catch(() => []),
      getAllTradeFilters().catch(() => ({ symbols: [], strategies: [] })),
    ]).then(([t, u, f]: any) => {
      setTrades(t.data || []);
      setTotal(t.total || 0);
      setUsers(u);
      setSymbols(f.symbols || []);
      setStrategies(f.strategies || []);
    }).finally(() => setLoading(false));
  }, []);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.username])), [users]);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = symbolFilter !== 'all' || sideFilter !== 'all' || strategyFilter !== 'all' || modeFilter !== 'all' || userFilter !== '' || pnlFilter !== 'all' || testnetFilter !== 'all' || exchangeFilter !== 'all';

  function resetFilters() {
    setSymbolFilter('all');
    setSideFilter('all');
    setStrategyFilter('all');
    setModeFilter('all');
    setTestnetFilter('all');
    setExchangeFilter('all');
    setPnlFilter('all');
    setExcludeZeroPnl(true);
    setUserFilter('');
    fetchPage(0, {
      symbol: 'all', side: 'all', strategy: 'all', mode: 'all', userId: '',
      pnl: 'all', testnet: 'all', exchange: 'all', excludeZero: true,
    });
  }

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{t('tradeHistory')}</h2>
          <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{total} {t('trades')}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50 mb-4">
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
            value={userFilter}
            onChange={(e) => { const v = e.target.value === '' ? '' as const : Number(e.target.value); setUserFilter(v); fetchPage(0, { userId: v }); }}
            className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="">{t('allUsers')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>

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
            <option value="false">{t('mainnet')}</option>
            <option value="true">{t('testnet')}</option>
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
              {t('clearFilters')}
            </button>
          )}
        </div>
      </div>

      {trades.length === 0 ? (
        <EmptyState icon="clipboard" message={total === 0 && !hasFilters ? t('noTradesYet') : t('noTradesMatch')} />
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800/50">
                  {([
                    { key: 'timestamp', label: t('time'), align: 'text-start' },
                    { key: null, label: t('user'), align: 'text-start' },
                    { key: 'symbol', label: t('asset'), align: 'text-start' },
                    { key: 'side', label: t('side'), align: 'text-start' },
                    { key: 'price', label: t('price'), align: 'text-end' },
                    { key: 'amount', label: t('amount'), align: 'text-end' },
                    { key: 'pnl', label: t('pnl'), align: 'text-end' },
                    { key: 'strategy', label: t('strategy'), align: 'text-start' },
                    { key: null, label: t('mode'), align: 'text-start' },
                  ] as const).map(({ key, label, align }, i) => (
                    <th
                      key={i}
                      className={`text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 ${align} ${key ? 'cursor-pointer select-none hover:text-gray-300 transition-colors' : ''}`}
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
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                    <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(trade.timestamp)}</td>
                    <td className="text-sm text-gray-300 px-4 py-3">{userMap.get(trade.userId) ?? (trade.userId === 0 ? '-' : `#${trade.userId}`)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <CryptoIcon symbol={trade.symbol} size={18} />
                        <span className="text-sm text-gray-200">{trade.symbol}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${trade.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {t(trade.side)}
                      </span>
                    </td>
                    <td className="text-sm text-gray-200 px-4 py-3 text-end">${trade.price.toFixed(2)}</td>
                    <td className="text-sm text-gray-200 px-4 py-3 text-end">${trade.amount.toFixed(2)}</td>
                    <td className={`text-sm px-4 py-3 text-end ${trade.pnl != null ? (trade.pnl >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}`}>
                      {trade.pnl != null ? `$${trade.pnl.toFixed(2)}` : '-'}
                    </td>
                    <td className="text-sm text-gray-400 px-4 py-3">{t(trade.strategy as any) || trade.strategy}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${trade.mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                          {t(trade.mode as any)}
                        </span>
                        {trade.mode === 'live' && trade.exchange && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {trade.exchange}
                          </span>
                        )}
                        {trade.mode === 'live' && trade.testnet && (
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            {t('testnet')}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={(v) => fetchPage(typeof v === 'function' ? v(page) : v)} />
          )}
        </div>
      )}
    </div>
  );
}
