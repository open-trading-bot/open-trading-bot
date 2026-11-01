import { useEffect, useMemo, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguageStore, CryptoIcon, EmptyState, Pagination, languages } from 'common';
import { getUsers, getUserTradesPaginated, getUserTradeFilters, getUserPositionsPaginated, getUserBotStatus, updateUser, getUserActionLogs, getDailyPnl } from '../lib/api';

const PAGE_SIZE = 15;

interface User { id: number; username: string; email: string | null; role: string; enabled: boolean; createdAt: number; lastLogin: number | null; walletAddress?: string | null; paperBalance: number; lang?: string; theme?: string; exchangeName?: string; exchangeTestnet?: boolean }
interface Trade { id: string; symbol: string; side: 'buy' | 'sell'; price: number; amount: number; pnl: number | null; strategy: string; mode: string; timestamp: number }
interface Position { id: string; symbol: string; side: string; entryPrice: number; currentPrice: number; amount: number; pnl: number; pnlPct: number; openedAt: number }
interface BotStatus { status: string; mode: string; blocked: boolean; testnet?: boolean }
interface ActionLog { id: number; userId: number; action: string; actorId: number; actorUsername: string; source: string; timestamp: number }

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, formatDateTime } = useLanguageStore();
  const [user, setUser] = useState<User | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesTotalUnfiltered, setTradesTotalUnfiltered] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsTotal, setPositionsTotal] = useState(0);
  const [botStatus, setBotStatus] = useState<BotStatus>({ status: 'stopped', mode: 'paper', blocked: false });
  const [dailyPnl, setDailyPnl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tradePage, setTradePage] = useState(0);
  const [positionPage, setPositionPage] = useState(0);
  const [tab, setTab] = useState<'trades' | 'positions' | 'logs'>('trades');
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const [posSubTab, setPosSubTab] = useState<'open' | 'closed'>('open');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'paper'>('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [pnlFilter, setPnlFilter] = useState<'all' | 'profit' | 'loss'>('all');
  const [excludeZeroPnl, setExcludeZeroPnl] = useState(true);
  const [actionFilter, setActionFilter] = useState<'all' | 'start' | 'stop' | 'kill'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'self' | 'backoffice'>('all');

  const userId = Number(id);

  const fetchTrades = useCallback((p: number, sym = symbolFilter, sd = sideFilter, str = strategyFilter, md = modeFilter, pnl = pnlFilter, exZero = excludeZeroPnl) => {
    const f: Record<string, any> = {};
    if (sym !== 'all') f.symbol = sym;
    if (sd !== 'all') f.side = sd;
    if (str !== 'all') f.strategy = str;
    if (md !== 'all') f.mode = md;
    if (pnl !== 'all') f.pnl = pnl;
    if (exZero) f.excludeZeroPnl = 'true';
    getUserTradesPaginated(userId, p, PAGE_SIZE, Object.keys(f).length > 0 ? f : undefined).then((res: any) => {
      setTrades(res.data);
      setTradesTotal(res.total);
      setTradePage(res.page);
    }).catch(() => {});
  }, [userId, symbolFilter, sideFilter, strategyFilter, modeFilter, pnlFilter, excludeZeroPnl]);

  const fetchPositions = useCallback((p: number) => {
    getUserPositionsPaginated(userId, p, PAGE_SIZE).then((res: any) => {
      setPositions(res.data);
      setPositionsTotal(res.total);
      setPositionPage(res.page);
    }).catch(() => {});
  }, [userId]);

  const fetchLogs = useCallback((p: number, act = actionFilter, src = sourceFilter) => {
    const f: Record<string, any> = {};
    if (act !== 'all') f.action = act;
    if (src !== 'all') f.source = src;
    getUserActionLogs(userId, p, PAGE_SIZE, Object.keys(f).length > 0 ? f : undefined).then((res: any) => {
      setLogs(res.data);
      setLogsTotal(res.total);
      setLogPage(res.page);
    }).catch(() => {});
  }, [userId, actionFilter, sourceFilter]);

  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [allStrategies, setAllStrategies] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      getUsers().catch(() => []),
      getUserTradesPaginated(userId, 0, PAGE_SIZE, { excludeZeroPnl: 'true' }).catch(() => ({ data: [], total: 0, page: 0 })),
      getUserTradesPaginated(userId, 0, 1).catch(() => ({ total: 0 })),
      getUserPositionsPaginated(userId, 0, PAGE_SIZE).catch(() => ({ data: [], total: 0, page: 0 })),
      getUserBotStatus(userId).catch(() => ({ status: 'stopped', mode: 'paper' })),
      getUserTradeFilters(userId).catch(() => ({ symbols: [], strategies: [] })),
      getUserActionLogs(userId, 0, PAGE_SIZE).catch(() => ({ data: [], total: 0, page: 0 })),
      getDailyPnl().catch(() => []),
    ]).then(([users, t, tAll, p, b, f, l, pnl]: any) => {
      setUser(users.find((u: User) => u.id === userId) ?? null);
      setTrades(t.data || t); setTradesTotal(t.total || 0);
      setTradesTotalUnfiltered(tAll.total || 0);
      setPositions(p.data || p); setPositionsTotal(p.total || 0);
      setBotStatus(b);
      setAllSymbols(f.symbols || []); setAllStrategies(f.strategies || []);
      setLogs(l.data || []); setLogsTotal(l.total || 0);
      const userPnl = (pnl as { userId: number; dailyPnl: number }[]).find((x: any) => x.userId === userId);
      setDailyPnl(userPnl?.dailyPnl ?? 0);
    }).finally(() => setLoading(false));
  }, [userId]);

  const filteredPositions = useMemo(() => positions.filter((pos) => {
    if (symbolFilter !== 'all' && pos.symbol !== symbolFilter) return false;
    if (sideFilter !== 'all' && pos.side !== sideFilter) return false;
    if (modeFilter !== 'all' && (pos as any).mode !== modeFilter) return false;
    return true;
  }), [positions, symbolFilter, sideFilter, modeFilter]);

  const hasFilters = symbolFilter !== 'all' || sideFilter !== 'all' || modeFilter !== 'all' || strategyFilter !== 'all' || pnlFilter !== 'all';

  const tradeTotalPages = Math.ceil(tradesTotal / PAGE_SIZE);
  const positionTotalPages = Math.ceil(positionsTotal / PAGE_SIZE);
  const logTotalPages = Math.ceil(logsTotal / PAGE_SIZE);

  if (loading) return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  if (!user) return <p className="text-gray-500 text-sm">User not found</p>;

  const roleBadge: Record<string, string> = {
    admin: 'bg-red-500/10 text-red-400 border-red-500/20',
    regular: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    demo: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/users')} className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-lg font-semibold text-white">{user.username}</h2>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${roleBadge[user.role] || 'bg-gray-500/10 text-gray-400'}`}>{t(user.role as any)}</span>
        <span className={`text-xs px-2 py-0.5 rounded-md ${user.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{user.enabled ? t('enabled') : t('disabled')}</span>
        {botStatus.blocked && <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">{t('blocked' as any)}</span>}
        <button onClick={() => navigate('/users', { state: { editUserId: user.id } })} className="ms-auto text-gray-500 hover:text-blue-400 transition-colors p-1.5 rounded-lg hover:bg-gray-800" title={t('editUser')}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('boBotStatus')}</p>
          <p className={`text-lg font-semibold ${botStatus.status === 'running' ? 'text-green-400' : 'text-gray-400'}`}>{t(botStatus.status as any)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('boBotMode')}</p>
          <div className="flex items-center flex-wrap gap-2">
            <p className={`text-lg font-semibold ${botStatus.mode === 'live' ? 'text-red-400' : 'text-blue-400'}`}>
              {t(botStatus.mode as any)}
            </p>
            {botStatus.mode === 'live' && (
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {user.exchangeName || 'bybit'}
              </span>
            )}
            {botStatus.mode === 'live' && (botStatus.testnet ?? user.exchangeTestnet) && (
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                {t('testnet')}
              </span>
            )}
            {botStatus.mode === 'live' && !(botStatus.testnet ?? user.exchangeTestnet) && (
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-green-500/10 text-green-400 border border-green-500/20">
                {t('mainnet')}
              </span>
            )}
          </div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('boTotalTrades')}</p>
          <p className="text-lg font-semibold">{tradesTotalUnfiltered}</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 p-4">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('totalPositions')}</p>
          <p className="text-lg font-semibold">{positionsTotal + tradesTotalUnfiltered}</p>
        </div>
        <div className={`rounded-xl border p-4 ${dailyPnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{t('daily')} {t('pnl')}</p>
          <p className={`text-lg font-semibold font-mono ${dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}
          </p>
        </div>
      </div>

      {/* User Info */}
      <div className="bg-gray-900 rounded-xl border border-gray-800/50 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">{t('email')}:</span> <span className="text-gray-200 ms-1">{user.email || '-'}</span></div>
          <div><span className="text-gray-500">{t('createdAt')}:</span> <span className="text-gray-200 ms-1">{formatDateTime(user.createdAt)}</span></div>
          <div><span className="text-gray-500">{t('lastLogin')}:</span> <span className="text-gray-200 ms-1">{user.lastLogin ? formatDateTime(user.lastLogin) : t('never')}</span></div>
          <div><span className="text-gray-500">{t('userId')}:</span> <span className="text-gray-200 ms-1 font-mono">{user.id}</span></div>
          <div><span className="text-gray-500">{t('language')}:</span> <span className="text-gray-200 ms-1">{languages[(user.lang || 'en') as keyof typeof languages]?.name ?? user.lang}</span></div>
          <div><span className="text-gray-500">{t('theme')}:</span> <span className="text-gray-200 ms-1">{t((user.theme || 'dark') as any)}</span></div>
          {user.walletAddress && <div><span className="text-gray-500">{t('wallet' as any)}:</span> <span className="text-gray-200 ms-1 font-mono">{user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}</span></div>}
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t('paperBalance')}:</span>
            <div className="relative">
              <span className="absolute start-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={user.paperBalance}
                onChange={(e) => setUser({ ...user, paperBalance: Number(e.target.value) })}
                onBlur={() => botStatus.mode !== 'live' && botStatus.status !== 'running' && updateUser(user.id, { paperBalance: user.paperBalance })}
                disabled={botStatus.mode === 'live' || botStatus.status === 'running'}
                className={`bg-gray-800 text-gray-200 rounded-lg ps-6 pe-2 py-1 text-sm w-28 border focus:outline-none font-mono ${botStatus.mode === 'live' || botStatus.status === 'running' ? 'border-gray-800 opacity-50 cursor-not-allowed' : 'border-gray-700 focus:border-blue-500'}`}
              />
            </div>
            <span className="text-[10px] text-yellow-400/70">
              {botStatus.mode === 'live' ? t('paperBalanceLiveNote' as any) : botStatus.status === 'running' ? t('paperBalanceRunningNote' as any) : t('paperBalanceNote')}
            </span>
          </div>
        </div>
      </div>

      {/* Tab Switcher + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800/50">
          <button onClick={() => { setTab('trades'); setTradePage(0); }} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${tab === 'trades' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t('trades')} ({tradesTotal})
          </button>
          <button onClick={() => setTab('positions')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${tab === 'positions' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t('positions')} ({positionsTotal + tradesTotal})
          </button>
          <button onClick={() => { setTab('logs'); fetchLogs(0); }} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${tab === 'logs' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t('actionLogs' as any)} ({logsTotal})
          </button>
        </div>

        {(tab === 'trades' || tab === 'positions') && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 text-xs">
              {(['all', 'buy', 'sell'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setSideFilter(f); fetchTrades(0, symbolFilter, f, strategyFilter, modeFilter, pnlFilter, excludeZeroPnl); }}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors ${sideFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  {f !== 'all' && <span className={`inline-block w-2 h-2 rounded-full me-1.5 ${f === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />}{f === 'buy' ? t('buy') : f === 'sell' ? t('sell') : t('all')}
                </button>
              ))}
            </div>
            <select value={symbolFilter} onChange={(e) => { setSymbolFilter(e.target.value); fetchTrades(0, e.target.value, sideFilter, strategyFilter, modeFilter, pnlFilter, excludeZeroPnl); }} className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none">
              <option value="all">{t('allSymbols')}</option>
              {allSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={modeFilter} onChange={(e) => { const v = e.target.value as typeof modeFilter; setModeFilter(v); fetchTrades(0, symbolFilter, sideFilter, strategyFilter, v, pnlFilter, excludeZeroPnl); }} className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none">
              <option value="all">{t('allModes')}</option>
              <option value="paper">{t('paper')}</option>
              <option value="live">{t('live')}</option>
            </select>
            {tab === 'trades' && (
              <select value={strategyFilter} onChange={(e) => { setStrategyFilter(e.target.value); fetchTrades(0, symbolFilter, sideFilter, e.target.value, modeFilter, pnlFilter, excludeZeroPnl); }} className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none">
                <option value="all">{t('allStrategies')}</option>
                {allStrategies.map((s) => <option key={s} value={s}>{t(s as any) || s}</option>)}
              </select>
            )}
            <select value={pnlFilter} onChange={(e) => { const v = e.target.value as typeof pnlFilter; setPnlFilter(v); fetchTrades(0, symbolFilter, sideFilter, strategyFilter, modeFilter, v, excludeZeroPnl); }} className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none">
              <option value="all">{t('allPnl')}</option>
              <option value="profit">{t('profitOnly')}</option>
              <option value="loss">{t('lossOnly')}</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={excludeZeroPnl} onChange={(e) => { setExcludeZeroPnl(e.target.checked); fetchTrades(0, symbolFilter, sideFilter, strategyFilter, modeFilter, pnlFilter, e.target.checked); }} className="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 w-3.5 h-3.5" />
              {t('hideZeroPnl')}
            </label>
            {hasFilters && (
              <button onClick={() => { setSymbolFilter('all'); setSideFilter('all'); setModeFilter('all'); setStrategyFilter('all'); setPnlFilter('all'); setExcludeZeroPnl(true); fetchTrades(0, 'all', 'all', 'all', 'all', 'all', true); }} className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                {t('clearFilters')}
              </button>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={actionFilter}
              onChange={(e) => { const v = e.target.value as typeof actionFilter; setActionFilter(v); fetchLogs(0, v, sourceFilter); }}
              className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">{t('allActions')}</option>
              <option value="start">{t('start')}</option>
              <option value="stop">{t('stop')}</option>
              <option value="kill">{t('kill')}</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => { const v = e.target.value as typeof sourceFilter; setSourceFilter(v); fetchLogs(0, actionFilter, v); }}
              className="bg-gray-800 text-xs text-gray-400 rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">{t('allSources')}</option>
              <option value="self">{t('actionSourceSelf')}</option>
              <option value="backoffice">{t('actionSourceBackoffice')}</option>
            </select>
            {(actionFilter !== 'all' || sourceFilter !== 'all') && (
              <button
                onClick={() => { setActionFilter('all'); setSourceFilter('all'); fetchLogs(0, 'all', 'all'); }}
                className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                {t('clearFilters')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Trades Tab */}
      {tab === 'trades' && (
        trades.length === 0 ? <EmptyState icon="clipboard" message={t('noTradesYet')} /> : (
          <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800/50">
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('time')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('asset')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('side')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('price')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('amount')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('pnl')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('strategy')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('mode')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id} onClick={() => setSelectedTrade(trade)} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                      <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(trade.timestamp)}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><CryptoIcon symbol={trade.symbol} size={18} /><span className="text-sm text-gray-200">{trade.symbol}</span></div></td>
                      <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded ${trade.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{t(trade.side)}</span></td>
                      <td className="text-sm text-gray-200 px-4 py-3 text-end">${trade.price.toFixed(2)}</td>
                      <td className="text-sm text-gray-200 px-4 py-3 text-end">${trade.amount.toFixed(2)}</td>
                      <td className={`text-sm px-4 py-3 text-end ${trade.pnl != null ? (trade.pnl >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}`}>{trade.pnl != null ? `$${trade.pnl.toFixed(2)}` : '-'}</td>
                      <td className="text-sm text-gray-400 px-4 py-3">{t(trade.strategy as any) || trade.strategy}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${(trade as any).mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{t((trade as any).mode || 'paper')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={tradePage} totalPages={tradeTotalPages} onPageChange={(v) => fetchTrades(typeof v === 'function' ? v(tradePage) : v)} />
          </div>
        )
      )}

      {/* Positions Tab */}
      {tab === 'positions' && (<>
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit border border-gray-800/50">
          <button onClick={() => setPosSubTab('open')} className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-all ${posSubTab === 'open' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t('open')} ({positionsTotal})
          </button>
          <button onClick={() => setPosSubTab('closed')} className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-all ${posSubTab === 'closed' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t('closed')} ({tradesTotal})
          </button>
        </div>

        {posSubTab === 'open' && (
          filteredPositions.length === 0 ? <EmptyState icon="folder" message={t('noOpenPositions')} /> : (
            <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800/50">
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('asset')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('side')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('entryPrice')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('currentPrice')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('amount')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('pnl')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('mode')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('openedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((pos) => (
                      <tr key={pos.id} onClick={() => setSelectedPosition(pos)} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><CryptoIcon symbol={pos.symbol} size={18} /><span className="text-sm text-gray-200">{pos.symbol}</span></div></td>
                        <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded ${pos.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{pos.side.toUpperCase()}</span></td>
                        <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.entryPrice.toFixed(2)}</td>
                        <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.currentPrice.toFixed(2)}</td>
                        <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.amount.toFixed(2)}</td>
                        <td className={`text-sm px-4 py-3 text-end ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${pos.pnl.toFixed(2)} ({pos.pnlPct.toFixed(1)}%)</td>
                        <td className="px-4 py-3"><span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${(pos as any).mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{t((pos as any).mode || 'paper')}</span></td>
                        <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(pos.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={positionPage} totalPages={positionTotalPages} onPageChange={(v) => fetchPositions(typeof v === 'function' ? v(positionPage) : v)} />
            </div>
          )
        )}

        {posSubTab === 'closed' && (
          trades.length === 0 ? <EmptyState icon="clipboard" message={t('noClosedTrades')} /> : (
            <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800/50">
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('asset')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('side')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('price')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('pnl')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('strategy')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('mode')}</th>
                      <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.filter((tr: any) => tr.pnl != null).map((tr: any) => (
                      <tr key={tr.id} onClick={() => setSelectedTrade(tr)} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><CryptoIcon symbol={tr.symbol} size={18} /><span className="text-sm text-gray-200">{tr.symbol}</span></div></td>
                        <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded ${tr.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{t(tr.side)}</span></td>
                        <td className="text-sm text-gray-200 px-4 py-3 text-end">${tr.price.toFixed(2)}</td>
                        <td className={`text-sm px-4 py-3 text-end ${tr.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${tr.pnl.toFixed(2)}</td>
                        <td className="text-sm text-gray-400 px-4 py-3">{t(tr.strategy as any) || tr.strategy}</td>
                        <td className="px-4 py-3"><span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${tr.mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{t(tr.mode as any)}</span></td>
                        <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(tr.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={tradePage} totalPages={tradeTotalPages} onPageChange={(v) => fetchTrades(typeof v === 'function' ? v(tradePage) : v)} />
            </div>
          )
        )}
      </>)}

      {/* Logs Tab */}
      {tab === 'logs' && (
        logs.length === 0 ? <EmptyState icon="clipboard" message={t('noActionLogs' as any)} /> : (
          <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800/50">
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('time')}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('action' as any)}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('actor' as any)}</th>
                    <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('source' as any)}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                      <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(log.timestamp)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${
                          log.action === 'start' ? 'bg-green-500/10 text-green-400' :
                          log.action === 'kill' ? 'bg-red-500/10 text-red-400' :
                          'bg-yellow-500/10 text-yellow-400'
                        }`}>{t(log.action as any)}</span>
                      </td>
                      <td className="text-sm text-gray-200 px-4 py-3">{log.actorUsername}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-md ${
                          log.source === 'backoffice' ? 'bg-purple-500/10 text-purple-400' : 'bg-gray-500/10 text-gray-400'
                        }`}>{t(log.source as any)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={logPage} totalPages={logTotalPages} onPageChange={(v) => fetchLogs(typeof v === 'function' ? v(logPage) : v)} />
          </div>
        )
      )}

      {/* Trade Detail Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedTrade(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedTrade.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedTrade.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedTrade.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{t(selectedTrade.side)}</span>
                </div>
              </div>
              <button onClick={() => setSelectedTrade(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('price')}</div>
                  <div className="font-mono font-semibold">${selectedTrade.price.toLocaleString()}</div>
                </div>
                <div className={`rounded-xl p-3 border ${(selectedTrade.pnl ?? 0) >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('pnl')}</div>
                  <div className={`font-mono font-semibold ${(selectedTrade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{selectedTrade.pnl != null ? `$${selectedTrade.pnl.toFixed(2)}` : '--'}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('amount')}</div>
                  <div className="font-mono font-semibold">${selectedTrade.amount.toFixed(2)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('strategy')}</div>
                  <div className="font-medium text-sm">{t(selectedTrade.strategy as any) || selectedTrade.strategy}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('mode')}</div>
                  <div className="font-medium text-sm">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${selectedTrade.mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{t(selectedTrade.mode as any)}</span>
                  </div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('timestamp')}</div>
                  <div className="font-mono text-sm">{formatDateTime(selectedTrade.timestamp)}</div>
                </div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('tradeId') || 'Trade ID'}</div>
                <div className="font-mono text-xs">{selectedTrade.id}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Position Detail Modal */}
      {selectedPosition && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedPosition(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedPosition.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedPosition.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedPosition.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{t(selectedPosition.side as any)}</span>
                </div>
              </div>
              <button onClick={() => setSelectedPosition(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className={`rounded-xl p-4 mb-4 border ${selectedPosition.pnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">{t('pnl')}</div>
                  <div className={`text-2xl font-mono font-bold ${selectedPosition.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{selectedPosition.pnl >= 0 ? '+' : ''}${selectedPosition.pnl.toFixed(2)}</div>
                </div>
                <div className={`text-xl font-mono font-bold ${selectedPosition.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{selectedPosition.pnlPct >= 0 ? '+' : ''}{selectedPosition.pnlPct.toFixed(2)}%</div>
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
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('amount')}</div>
                  <div className="font-mono font-semibold">${selectedPosition.amount.toFixed(2)}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('mode')}</div>
                  <div className="font-medium text-sm">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${(selectedPosition as any).mode === 'live' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>{t((selectedPosition as any).mode || 'paper')}</span>
                  </div>
                </div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('openedAt')}</div>
                <div className="font-mono text-sm">{formatDateTime(selectedPosition.openedAt)}</div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('positionId') || 'Position ID'}</div>
                <div className="font-mono text-xs">{selectedPosition.id}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
