// client/src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBotStore, type Signal } from '../stores/bot';
import { getPortfolio, getPortfolioBalance, getPositions, getTrades, startBot, stopBot, killBot, closePosition, checkExchangeKeyPermissions, getExchangeKeys } from '../lib/api';
import { CryptoIcon, useLanguageStore, useThemeStore } from 'common';
import { maskAmount } from '../utils/mask';

const POSITIONS_PER_PAGE = 5;
const SIGNALS_PER_PAGE = 8;
const POSITIONS_FETCH_LIMIT = 100;
const TRADES_FETCH_LIMIT = 20;
const TICK_REFRESH_INTERVAL = 10000;
const HOLD_OPACITY = 0.5;
const OPACITY_STEP = 0.05;
const ANIMATION_DELAY_STEP = 0.05;
const HIGH_CONFIDENCE = 0.7;
const MEDIUM_CONFIDENCE = 0.4;

interface Position {
  id: string; symbol: string; side: string; entryPrice: number; quantity: number;
  amount: number; currentPrice: number; pnl: number; pnlPct: number;
  strategy: string; marketType: string; stopLoss: number | null; openedAt: number;
  mode?: string; testnet?: boolean; exchange?: string;
}

function formatTimeAgo(timestamp: number, t: (k: any) => string): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 10) return t('justNow');
  if (diff < 60) return `${diff}${t('secondsShort')} ${t('ago')}`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}${t('minutesShort')} ${t('ago')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t('hoursShort')} ${t('ago')}`;
  const days = Math.floor(hrs / 24);
  return `${days}${t('daysShort')} ${t('ago')}`;
}

function formatDuration(ms: number, t: (k: any) => string): string {
  const MS_PER_MINUTE = 60000;
  const MINUTES_PER_DAY = 1440;
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${t('days')}`);
  if (hours > 0) parts.push(`${hours} ${t('hours')}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${t('minutes')}`);
  return parts.join(', ');
}

export function Dashboard() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, []);
  const store = useBotStore();
  const { theme } = useThemeStore();

  const [btnAnim, setBtnAnim] = useState<'idle' | 'starting' | 'stopping' | 'killing'>('idle');
  const [positionPage, setPositionPage] = useState(0);
  const [signalPage, setSignalPage] = useState(0);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [signalFilters, setSignalFilters] = useState<Set<string>>(new Set());
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [confirmClosePage, setConfirmClosePage] = useState(0);
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);
  const { t, formatDateTime } = useLanguageStore();

  const CONFIRM_PAGE_SIZE = 5;

  useEffect(() => {
    if (confirmCloseAll) setConfirmClosePage(0);
  }, [confirmCloseAll]);

  const performCloseAll = () => {
    setConfirmCloseAll(false);
    setBtnAnim('killing');
    killBot().then(async (d) => {
      store.setStatus(d.status);
      const [portfolio, balance, positions, trades] = await Promise.all([getPortfolio(), getPortfolioBalance(), getPositions(0, POSITIONS_FETCH_LIMIT), getTrades(0, TRADES_FETCH_LIMIT)]);
      store.setPortfolio({ totalBalance: balance.totalBalance, availableBalance: balance.availableBalance, totalEquity: balance.totalEquity, dailyPnl: portfolio.dailyPnl, totalPnl: portfolio.totalPnl });
      store.setPositions(positions.data);
      store.setTrades(trades.data);
      setBtnAnim('idle');
    }).catch(() => setBtnAnim('idle'));
  };

  const toggleSignalFilter = (f: string) => {
    setSignalFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      if (next.size === 3) return new Set();
      return next;
    });
    setSignalPage(0);
  };

  const sortedSignals = useMemo(() => {
    const sorted = [...store.signals].sort((a, b) => b.timestamp - a.timestamp);
    return signalFilters.size === 0 ? sorted : sorted.filter((s) => signalFilters.has(s.action));
  }, [store.signals, signalFilters]);
  const signalTotalPages = Math.ceil(sortedSignals.length / SIGNALS_PER_PAGE);
  const safePage = Math.min(signalPage, Math.max(0, signalTotalPages - 1));
  const paginatedSignals = sortedSignals.slice(safePage * SIGNALS_PER_PAGE, (safePage + 1) * SIGNALS_PER_PAGE);

  useEffect(() => {
    async function load() {
      const [portfolio, balance, positions, trades] = await Promise.all([getPortfolio(), getPortfolioBalance(), getPositions(0, POSITIONS_FETCH_LIMIT), getTrades(0, TRADES_FETCH_LIMIT)]);
      store.setPortfolio({
        totalBalance: balance.totalBalance,
        availableBalance: balance.availableBalance,
        totalEquity: balance.totalEquity,
        dailyPnl: portfolio.dailyPnl,
        totalPnl: portfolio.totalPnl,
      });
      store.setPositions(positions.data);
      store.setTrades(trades.data);
    }
    load();
  }, []);

  // Check stored key permissions once per mount so bot controls can be
  // gated when the key is read-only. If Settings already populated the
  // store, skip the extra network call. On any error, leave the status
  // as-is (don't block controls on a transient network failure).
  useEffect(() => {
    if (store.keyReadOnly !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const keys = await getExchangeKeys();
        if (cancelled) return;
        if (!keys.hasKeys) { store.setKeyReadOnly(false); return; }
        const res: any = await checkExchangeKeyPermissions();
        if (cancelled) return;
        if (res?.checked) {
          store.setKeyReadOnly(!!res.readOnly || !res.canTrade);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive open PnL locally from positions — avoids a portfolio refetch on
  // every position:update WebSocket event.
  const openPnl = store.positions.reduce((sum, p) => sum + p.pnl, 0);
  const inPositionsValue = store.positions.reduce(
    (sum, p) => sum + p.amount,
    0,
  );
  const stats: Array<{ label: string; value: React.ReactNode; color?: boolean; subValue?: React.ReactNode }> = [
    {
      label: t('openPositions'),
      value: store.positions.length,
    },
    { label: t('winRate'), value: `${calcWinRate(store.trades)}%` },
    { label: t('todaysTrades'), value: store.trades.filter((t) => isToday(t.timestamp)).length },
    { label: t('totalPnl'), value: maskAmount(`$${openPnl.toFixed(2)}`, store.balancesHidden), color: openPnl >= 0 },
  ];

  const liveReadOnlyBlocked = store.mode === 'live' && store.keyReadOnly === true;

  return (
    <div className="space-y-5">
      {/* Read-only key warning — blocks bot controls when in live mode with a read-only key */}
      {liveReadOnlyBlocked && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400 mb-0.5">{t('liveReadOnlyKeyTitle')}</p>
            <p className="text-xs text-red-300/80 leading-relaxed">{t('dashboardReadOnlyKeyBody')}</p>
            <Link to="/settings" className="inline-block mt-2 text-[11px] px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30">
              {t('liveReadOnlyKeyAction')}
            </Link>
          </div>
        </div>
      )}

      {/* Bot Controls */}
      <div className="flex items-center gap-3">
        {store.status !== 'running' ? (<>
          <button
            onClick={() => {
              if (liveReadOnlyBlocked) { alert(t('liveReadOnlyKeyTitle')); return; }
              if (store.totalEquity < 1) { alert(t('zeroBalance')); return; }
              setBtnAnim('starting');
              startBot().then((d) => { store.setStatus(d.status); setBtnAnim('idle'); }).catch((err) => { setBtnAnim('idle'); alert(err.response?.data?.error || err.message); });
            }}
            disabled={btnAnim === 'starting' || store.totalEquity < 1 || liveReadOnlyBlocked}
            className={`bot-btn bot-btn-start group relative w-full text-xl px-8 py-5 rounded-2xl font-bold transition-all overflow-hidden border ${btnAnim === 'starting' ? 'bot-btn-starting' : ''} ${
              store.totalEquity < 1 || liveReadOnlyBlocked
                ? 'opacity-50 cursor-not-allowed bg-gray-900 text-gray-500 border-gray-800/50'
                : theme === 'light'
                  ? 'bg-white hover:bg-gray-50 text-gray-800 border-gray-200 shadow-lg shadow-gray-200/40 hover:shadow-gray-300/50'
                  : 'bg-gray-900 hover:bg-gray-800 text-white border-gray-800/50 hover:border-gray-700/50 shadow-lg shadow-gray-900/40'
            }`}
          >
            <div className={`bot-btn-shine ${btnAnim === 'starting' ? 'bot-btn-shine-active' : ''}`} />
            <div className="bot-btn-ripple-container" />
            <span className="relative flex items-center justify-center gap-3">
              {btnAnim === 'starting' ? (
                <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {t('start')}
            </span>
          </button>
          {store.totalEquity < 1 && (
            <p className="text-xs text-red-400 text-center mt-2">
              {t('zeroBalance')}{store.mode === 'live' && store.testnet ? ` — ${t('testnetFundRequired')}` : ''}
            </p>
          )}
        </>) : (
          <div className="group relative flex items-center gap-2 w-full">
            <button
              onClick={() => {
                if (!confirm(t('stopConfirm'))) return;
                setBtnAnim('stopping');
                stopBot().then(async (d) => {
                  store.setStatus(d.status);
                  const [portfolio, balance, positions] = await Promise.all([getPortfolio(), getPortfolioBalance(), getPositions(0, POSITIONS_FETCH_LIMIT)]);
                  store.setPortfolio({ totalBalance: balance.totalBalance, availableBalance: balance.availableBalance, totalEquity: balance.totalEquity, dailyPnl: portfolio.dailyPnl, totalPnl: portfolio.totalPnl });
                  store.setPositions(positions.data);
                  setBtnAnim('idle');
                }).catch(() => setBtnAnim('idle'));
              }}
              disabled={btnAnim === 'stopping'}
              className={`bot-btn flex-1 text-xl px-8 py-5 rounded-2xl font-bold transition-all relative overflow-hidden ${btnAnim === 'stopping' ? 'bot-btn-stopping' : ''} ${
                theme === 'light'
                  ? 'bg-gray-200 hover:bg-gray-300 text-gray-800 shadow-lg shadow-gray-300/30'
                  : 'bg-gray-700 hover:bg-gray-600 text-white shadow-lg shadow-gray-900/30'
              }`}
            >
              <span className="relative flex items-center justify-center gap-3">
                {btnAnim === 'stopping' ? (
                  <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                )}
                {t('stop')}
              </span>
            </button>
            <button
              onClick={() => {
                if (!confirm(t('killConfirm'))) return;
                setBtnAnim('killing');
                killBot().then(async (d) => {
                  store.setStatus(d.status);
                  const [portfolio, balance, positions, trades] = await Promise.all([getPortfolio(), getPortfolioBalance(), getPositions(0, POSITIONS_FETCH_LIMIT), getTrades(0, TRADES_FETCH_LIMIT)]);
                  store.setPortfolio({ totalBalance: balance.totalBalance, availableBalance: balance.availableBalance, totalEquity: balance.totalEquity, dailyPnl: portfolio.dailyPnl, totalPnl: portfolio.totalPnl });
                  store.setPositions(positions.data);
                  store.setTrades(trades.data);
                  setBtnAnim('idle');
                }).catch(() => setBtnAnim('idle'));
              }}
              disabled={btnAnim === 'killing'}
              className={`bot-btn md:opacity-0 md:group-hover:opacity-100 text-white text-sm px-6 py-5 rounded-2xl font-medium transition-all relative overflow-hidden ${btnAnim === 'killing' ? 'bot-btn-killing md:opacity-100' : ''} ${
                theme === 'light'
                  ? 'bg-red-500/80 hover:bg-red-500 shadow-lg shadow-red-400/20'
                  : 'bg-red-600/80 hover:bg-red-600 shadow-lg shadow-red-900/20'
              }`}
            >
              <span className="relative flex items-center justify-center gap-2">
                {btnAnim === 'killing' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {t('kill')}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800/50 hover:border-gray-700/50 transition-colors">
            <div className="mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</span>
            </div>
            <div className={`text-2xl font-mono font-semibold ${s.color !== undefined ? (s.color ? 'text-green-400' : 'text-red-400') : ''}`}>
              {s.value}
            </div>
            {s.subValue && (
              <div className="text-[10px] font-mono text-gray-500 mt-1">
                {s.subValue}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Positions Summary */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-400">{t('openPositions')}</h3>
            {inPositionsValue > 0.5 && (
              <span className="text-xs font-mono text-gray-500">
                {maskAmount(`$${inPositionsValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, store.balancesHidden)} {t('inPositions')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {store.positions.length > 0 && store.status !== 'running' && (
              <button
                onClick={() => setConfirmCloseAll(true)}
                disabled={btnAnim === 'killing'}
                className="text-xs px-2.5 py-1 rounded-lg font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                {btnAnim === 'killing' ? t('closing') : t('closeAll')}
              </button>
            )}
            <span className="text-xs text-gray-600">{store.positions.length} {t('total')}</span>
          </div>
        </div>
        {store.positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-600">
            <div className="relative mb-3 animate-float">
              <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <div className="absolute inset-0 rounded-full bg-gray-500/10 animate-pulse-ring" />
            </div>
            <p className="text-sm">{t('noOpenPositions')}</p>
          </div>
        ) : (() => {
          const totalPages = Math.ceil(store.positions.length / POSITIONS_PER_PAGE);
          const safePage = Math.min(positionPage, Math.max(0, totalPages - 1));
          const paginated = store.positions.slice(safePage * POSITIONS_PER_PAGE, (safePage + 1) * POSITIONS_PER_PAGE);
          return (
            <>
              <div key={safePage} className="space-y-2" style={{ animation: 'position-page-fade 0.3s ease-out' }}>
                {paginated.map((p) => (
                  <div key={p.id} onClick={() => setSelectedPosition(p as Position)} className="flex justify-between items-center bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-800/50 hover:border-gray-700/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CryptoIcon symbol={p.symbol} size={24} />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.symbol}</span>
                          <span className={`text-xs font-semibold uppercase ${p.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {t(p.side as 'buy' | 'sell')}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-500 mt-0.5">
                          {maskAmount(`$${p.amount.toFixed(2)}`, store.balancesHidden)} {t('locked')}
                        </span>
                      </div>
                    </div>
                    <div className="text-end">
                      <span className={`font-mono font-semibold ${p.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {maskAmount(`${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`, store.balancesHidden)}
                      </span>
                      <div className={`text-xs font-mono ${p.pnl >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                        {maskAmount(`$${p.pnl.toFixed(2)}`, store.balancesHidden)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-3">
                  <button
                    onClick={() => setPositionPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('prev')}
                  </button>
                  <span className="text-xs text-gray-500 font-mono">{safePage + 1} / {totalPages}</span>
                  <button
                    onClick={() => setPositionPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage === totalPages - 1}
                    className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('next')}
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Recent Signals */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-400">{t('recentSignals')}</h3>
            <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{sortedSignals.length}</span>
            <span className="text-[10px] text-gray-600">{t('last100Signals')}</span>
          </div>
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => { setSignalFilters(new Set()); setSignalPage(0); }}
              className={`px-2.5 py-1 rounded-lg transition-colors ${signalFilters.size === 0 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {t('all')}
            </button>
            {(['buy', 'sell', 'hold'] as const).map((f) => (
              <button
                key={f}
                onClick={() => toggleSignalFilter(f)}
                className={`px-2.5 py-1 rounded-lg transition-colors ${signalFilters.has(f) ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                <span className={`inline-block w-2 h-2 rounded-full me-1.5 ${f === 'buy' ? 'bg-green-400' : f === 'sell' ? 'bg-red-400' : 'bg-gray-400'}`} />{t(f)}
              </button>
            ))}
          </div>
        </div>
        {paginatedSignals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-600">
            <div className="relative mb-3">
              <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.788m13.788 0c3.808 3.808 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-pulse-ring" />
              <div className="absolute inset-[-4px] border-2 border-transparent border-t-blue-500/30 rounded-full animate-radar" />
            </div>
            <p className="text-sm">{t('noSignalsYet')}</p>
          </div>
        ) : (
          <>
            <div key={`${safePage}-${Array.from(signalFilters).join(',')}`} className="grid gap-2.5">
              {paginatedSignals.map((s, i) => {
                const isNewest = i === 0 && safePage === 0 && s.action !== 'hold';
                const actionColor = s.action === 'buy' ? 'green' : s.action === 'sell' ? 'red' : 'gray';
                const confPct = (s.confidence * 100).toFixed(0);

                return (
                  <div
                    key={`${safePage}-${i}`}
                    onClick={() => setSelectedSignal(s)}
                    className={`signal-card signal-card-${s.action} ${isNewest ? 'signal-card-newest' : ''} relative overflow-hidden rounded-xl px-4 py-3 cursor-pointer transition-colors hover:border-gray-600/50`}
                    style={{
                      opacity: s.action === 'hold' ? HOLD_OPACITY : 1 - i * OPACITY_STEP,
                      animationDelay: `${i * ANIMATION_DELAY_STEP}s`,
                    }}
                  >
                    {/* Shimmer bar — newest only */}
                    {isNewest && (
                      <div
                        className="signal-shimmer-bar"
                        style={{ color: actionColor === 'green' ? '#4ade80' : actionColor === 'red' ? '#f87171' : '#9ca3af' }}
                      />
                    )}

                    <div className="flex items-center gap-3">
                      {/* Action icon with ping */}
                      <div className="relative flex-shrink-0">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center"
                          style={{
                            background: `radial-gradient(circle, ${
                              actionColor === 'green'
                                ? 'rgba(74,222,128,0.25)'
                                : actionColor === 'red'
                                  ? 'rgba(248,113,113,0.25)'
                                  : 'rgba(107,114,128,0.2)'
                            } 0%, transparent 70%)`,
                          }}
                        >
                          <span
                            className="text-lg font-extrabold"
                            style={{
                              color:
                                actionColor === 'green'
                                  ? '#4ade80'
                                  : actionColor === 'red'
                                    ? '#f87171'
                                    : '#9ca3af',
                            }}
                          >
                            {s.action === 'buy' ? '\u2191' : s.action === 'sell' ? '\u2193' : '\u2022'}
                          </span>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CryptoIcon symbol={s.symbol} size={20} />
                          <span className="text-sm font-semibold">{s.symbol}</span>
                          <span
                            className="text-xs font-bold uppercase px-2 py-0.5 rounded-full"
                            style={{
                              color:
                                actionColor === 'green'
                                  ? '#4ade80'
                                  : actionColor === 'red'
                                    ? '#f87171'
                                    : '#9ca3af',
                              background:
                                actionColor === 'green'
                                  ? 'rgba(74,222,128,0.15)'
                                  : actionColor === 'red'
                                    ? 'rgba(248,113,113,0.15)'
                                    : 'rgba(107,114,128,0.12)',
                              letterSpacing: '0.05em',
                            }}
                          >
                            {t(s.action as any)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span>{t(s.strategy as any) || s.strategy}</span>
                          <span className="text-gray-700">|</span>
                          <span className="font-mono">${s.price.toLocaleString()}</span>
                          <span className="text-gray-700">|</span>
                          <div className="flex items-center gap-1.5">
                            <div className="signal-confidence-bar w-10 h-1 rounded-full bg-gray-700 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${confPct}%`,
                                  background:
                                    actionColor === 'green'
                                      ? 'linear-gradient(90deg, #4ade80, #22d3ee)'
                                      : actionColor === 'red'
                                        ? 'linear-gradient(90deg, #f87171, #fb923c)'
                                        : 'linear-gradient(90deg, #6b7280, #9ca3af)',
                                }}
                              />
                            </div>
                            <span
                              className="font-mono"
                              style={{
                                color:
                                  s.confidence >= HIGH_CONFIDENCE
                                    ? '#4ade80'
                                    : s.confidence >= MEDIUM_CONFIDENCE
                                      ? '#fbbf24'
                                      : '#6b7280',
                              }}
                            >
                              {confPct}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Time */}
                      <span className="text-xs text-gray-600 whitespace-nowrap flex-shrink-0">
                        {formatTimeAgo(s.timestamp, t)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {signalTotalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={() => setSignalPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('prev')}
                </button>
                <span className="text-xs text-gray-500 font-mono">{safePage + 1} / {signalTotalPages}</span>
                <button
                  onClick={() => setSignalPage((p) => Math.min(signalTotalPages - 1, p + 1))}
                  disabled={safePage === signalTotalPages - 1}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('next')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Position Detail Modal */}
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
              <button onClick={() => setSelectedPosition(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className={`rounded-xl p-4 mb-4 border ${selectedPosition.pnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">{t('pnl')}</div>
                  <div className={`text-2xl font-mono font-bold ${selectedPosition.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {maskAmount(`${selectedPosition.pnl >= 0 ? '+' : ''}$${selectedPosition.pnl.toFixed(2)}`, store.balancesHidden)}
                  </div>
                </div>
                <div className={`text-xl font-mono font-bold ${selectedPosition.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {maskAmount(`${selectedPosition.pnlPct >= 0 ? '+' : ''}${selectedPosition.pnlPct.toFixed(2)}%`, store.balancesHidden)}
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
                onClick={async () => {
                  if (!confirm(`${t('confirmClosePosition', { symbol: selectedPosition.symbol })}`)) return;
                  setClosingPositionId(selectedPosition.id);
                  try {
                    await closePosition(selectedPosition.id);
                    setSelectedPosition(null);
                    getPositions(0, 100).then((r) => store.setPositions(r.data));
                  } catch (err: any) {
                    alert(err?.response?.data?.error || err.message);
                  } finally {
                    setClosingPositionId(null);
                  }
                }}
                disabled={closingPositionId === selectedPosition.id}
                className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {closingPositionId === selectedPosition.id ? t('closing') : `${t('close')} ${selectedPosition.symbol}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signal Detail Modal */}
      {selectedSignal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedSignal(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={selectedSignal.symbol} size={36} />
                <div>
                  <h3 className="text-lg font-semibold">{selectedSignal.symbol}</h3>
                  <span className={`text-xs font-semibold uppercase ${selectedSignal.action === 'buy' ? 'text-green-400' : selectedSignal.action === 'sell' ? 'text-red-400' : 'text-gray-500'}`}>
                    {t(selectedSignal.action as any)}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedSignal(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('price')}</div>
                  <div className="font-mono font-semibold">${selectedSignal.price.toLocaleString()}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('confidence')}</div>
                  <div className={`font-mono font-semibold ${selectedSignal.confidence >= HIGH_CONFIDENCE ? 'text-green-400' : selectedSignal.confidence >= MEDIUM_CONFIDENCE ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {(selectedSignal.confidence * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('strategy')}</div>
                  <div className="font-medium text-sm">{t(selectedSignal.strategy as any) || selectedSignal.strategy}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('marketType')}</div>
                  <div className="font-medium text-sm capitalize">{t(selectedSignal.marketType as any)}</div>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('timestamp')}</div>
                <div className="font-mono text-sm">{formatDateTime(selectedSignal.timestamp)}</div>
              </div>

              <div className={`rounded-xl p-3 border ${selectedSignal.action === 'buy' ? 'bg-green-500/5 border-green-500/20' : selectedSignal.action === 'sell' ? 'bg-red-500/5 border-red-500/20' : 'bg-gray-800/60 border-gray-800/50'}`}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('signalAction')}</div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-full ${selectedSignal.action === 'buy' ? 'bg-green-400' : selectedSignal.action === 'sell' ? 'bg-red-400' : 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-300">
                    {selectedSignal.action === 'buy'
                      ? t('buyDescription')
                      : selectedSignal.action === 'sell'
                        ? t('sellDescription')
                        : t('holdDescription')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Close All Modal */}
      {confirmCloseAll && (() => {
        const totalPnl = store.positions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        const count = store.positions.length;
        const totalPages = Math.max(1, Math.ceil(count / CONFIRM_PAGE_SIZE));
        const page = Math.min(confirmClosePage, totalPages - 1);
        const pageStart = page * CONFIRM_PAGE_SIZE;
        const pagePositions = store.positions.slice(pageStart, pageStart + CONFIRM_PAGE_SIZE);
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setConfirmCloseAll(false)}>
            <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-5">
                <h3 className="text-lg font-semibold">{t('closeAllConfirm')}</h3>
                <div className="text-xs text-gray-500 mt-1">{count} {t('openPositions')}</div>
              </div>

              <div className={`rounded-xl p-4 mb-5 border ${totalPnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('estimatedPnl') || 'Estimated P&L'}</div>
                <div className={`text-2xl font-mono font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnl >= 0 ? '+' : '−'}${Math.abs(totalPnl).toFixed(2)}
                </div>
              </div>

              <div className="space-y-1.5 mb-3">
                {pagePositions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2 border border-gray-800/50">
                    <div className="flex items-center gap-2">
                      <CryptoIcon symbol={p.symbol} size={16} />
                      <span className="text-sm font-medium">{p.symbol}</span>
                    </div>
                    <div className={`text-xs font-mono font-semibold ${(p.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(p.pnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.pnl ?? 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mb-5">
                  <button
                    onClick={() => setConfirmClosePage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('prev')}
                  </button>
                  <span className="text-xs text-gray-500 font-mono">{page + 1} / {totalPages}</span>
                  <button
                    onClick={() => setConfirmClosePage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('next')}
                  </button>
                </div>
              )}

              <div className="flex gap-2.5">
                <button
                  onClick={() => setConfirmCloseAll(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={performCloseAll}
                  disabled={btnAnim === 'killing'}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {btnAnim === 'killing' ? t('closing') : t('closeAll')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function calcWinRate(trades: { pnl: number | null }[]): string {
  const closed = trades.filter((t) => t.pnl !== null);
  if (closed.length === 0) return '0';
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return ((wins / closed.length) * 100).toFixed(0);
}

function isToday(timestamp: number): boolean {
  const d = new Date(timestamp);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}
