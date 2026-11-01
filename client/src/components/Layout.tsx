// client/src/components/Layout.tsx
import { useEffect, useRef, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { NavLink } from 'react-router-dom';
import { getStatus, getPortfolio, getPortfolioBalance, getPositions, getTrades } from '../lib/api';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '../stores/bot';
import { useFeatureFlagStore } from '../stores/featureFlags';
import { useThemeStore, useLanguageStore, languages, useWebSocket } from 'common';
import { setFaviconStatus } from '../utils/favicon';

export function Layout() {
  const { setStatus, setMode, setTestnet, setReady, setLastTickAt, setTickInterval, addSignal, addSignals, addTrade, updatePosition, setPortfolio, setPositions, setTrades } = useBotStore(useShallow((s) => ({ setStatus: s.setStatus, setMode: s.setMode, setTestnet: s.setTestnet, setReady: s.setReady, setLastTickAt: s.setLastTickAt, setTickInterval: s.setTickInterval, addSignal: s.addSignal, addSignals: s.addSignals, addTrade: s.addTrade, updatePosition: s.updatePosition, setPortfolio: s.setPortfolio, setPositions: s.setPositions, setTrades: s.setTrades })));
  const botStatus = useBotStore((s) => s.status);
  const botMode = useBotStore((s) => s.mode);
  const { theme } = useThemeStore();
  const { lang, t } = useLanguageStore();
  const { fetchFlags, isEnabled } = useFeatureFlagStore();

  const tabs = [
    { to: '/', label: t('dashboard') },
    { to: '/positions', label: t('positions') },
    { to: '/trades', label: t('trades') },
    { to: '/strategies', label: t('strategies') },
    { to: '/reports', label: t('reports') },
    { to: '/settings', label: t('settings') },
    ...(isEnabled('backtest') ? [{ to: '/backtest', label: t('backtest') }] : []),
  ];

  useEffect(() => {
    fetchFlags();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  useEffect(() => {
    document.documentElement.dir = languages[lang].dir;
    document.title = t('loginTitle');
  }, [lang]);

  useEffect(() => {
    setFaviconStatus(botStatus, botMode);
  }, [botStatus, botMode]);

  useEffect(() => {
    getStatus().then((data) => {
      setStatus(data.status);
      if (data.config?.mode) setMode(data.config.mode);
      if (data.testnet !== undefined) setTestnet(data.testnet);
      if (data.lastTickAt) setLastTickAt(data.lastTickAt);
      if (data.config?.tickInterval) setTickInterval(data.config.tickInterval);
    }).catch(() => {}).finally(() => setReady(true));
    getPortfolio().then((p) => setPortfolio({ dailyPnl: p.dailyPnl, totalPnl: p.totalPnl })).catch(() => {});
    getPortfolioBalance().then((b) => setPortfolio({ totalBalance: b.totalBalance, availableBalance: b.availableBalance, totalEquity: b.totalEquity })).catch(() => {});
  }, [setStatus, setMode, setReady, setLastTickAt, setTickInterval, setPortfolio]);

  const portfolioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPortfolio = useCallback(() => {
    if (portfolioTimer.current) clearTimeout(portfolioTimer.current);
    portfolioTimer.current = setTimeout(() => {
      Promise.all([getPortfolio(), getPortfolioBalance()])
        .then(([p, b]) => setPortfolio({
          dailyPnl: p.dailyPnl,
          totalPnl: p.totalPnl,
          totalBalance: b.totalBalance,
          availableBalance: b.availableBalance,
          totalEquity: b.totalEquity ?? b.totalBalance,
        }))
        .catch(() => {});
    }, 500);
  }, [setPortfolio]);

  useWebSocket((event) => {
    if (event.type === 'tick:complete') {
      const d = event.data as { lastTickAt: number };
      setLastTickAt(d.lastTickAt);
    }
    if (event.type === 'bot:status') {
      const d = event.data as { status: 'running' | 'paused' | 'stopped'; mode: 'live' | 'paper' };
      setStatus(d.status);
      setMode(d.mode);
    }
    if (event.type === 'signals:batch') {
      addSignals(event.data as any);
    }
    // Older servers send one message per signal.
    if (event.type === 'signal:generated') {
      addSignal(event.data as any);
    }
    if (event.type === 'trade:executed') {
      addTrade(event.data as any);
      fetchPortfolio();
      getPositions(0, 100).then((r) => setPositions(r.data)).catch(() => {});
      getTrades(0, 20).then((r) => setTrades(r.data)).catch(() => {});
    }
    if (event.type === 'position:update') {
      updatePosition(event.data as any);
      // Deliberately NOT refetching portfolio here. position:update fires once
      // per open position per tick; refetching the portfolio per event costs a
      // full Bybit fetchBalance round-trip. Open PnL is derived from the
      // already-updated positions in the store (see Dashboard stats).
    }
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <TopBar />

      {/* Desktop tabs */}
      <nav className="hidden md:block bg-gray-900/50 backdrop-blur-sm border-b border-gray-800/50">
        <div className="flex items-center gap-1 max-w-7xl mx-auto px-4">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${isActive ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`
              }
            >
              {tab.label}
            </NavLink>
          ))}

        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-5 pb-20 md:pb-5">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
