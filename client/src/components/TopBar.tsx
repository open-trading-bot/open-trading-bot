// client/src/components/TopBar.tsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '../stores/bot';
import { getWallet, connectWallet as apiConnectWallet, disconnectWallet as apiDisconnectWallet } from '../lib/api';
import { useLanguageStore, useAuthStore } from 'common';
import { useFeatureFlagStore } from '../stores/featureFlags';
import { maskAmount } from '../utils/mask';

declare global { interface Window { ethereum?: any } }
const WALLET_SIGN_MESSAGE = 'Sign this message to connect your wallet to Trading Bot.\n\nThis does not cost any gas fees.';

function useNextTickCountdown() {
  const { status, lastTickAt, tickInterval } = useBotStore(useShallow((s) => ({ status: s.status, lastTickAt: s.lastTickAt, tickInterval: s.tickInterval })));
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (status !== 'running' || !lastTickAt) { setSecondsLeft(null); return; }
    const update = () => {
      const elapsed = (Date.now() - lastTickAt) / 1000;
      const remaining = Math.max(0, tickInterval - elapsed);
      setSecondsLeft(Math.ceil(remaining));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, lastTickAt, tickInterval]);

  return secondsLeft;
}

export function TopBar() {
  const { ready, status, mode, testnet, totalBalance, totalEquity, dailyPnl, portfolioLoaded, balancesHidden, toggleBalancesHidden } = useBotStore(useShallow((s) => ({ ready: s.ready, status: s.status, mode: s.mode, testnet: s.testnet, totalBalance: s.totalBalance, totalEquity: s.totalEquity, dailyPnl: s.dailyPnl, portfolioLoaded: s.portfolioLoaded, balancesHidden: s.balancesHidden, toggleBalancesHidden: s.toggleBalancesHidden })));
  const secondsLeft = useNextTickCountdown();
  const { t } = useLanguageStore();
  const { logout, isDemo, username, email } = useAuthStore();
  const demo = isDemo();
  const { isEnabled } = useFeatureFlagStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!demo) getWallet().then((w) => setWalletAddress(w.address)).catch(() => {});
  }, []);

  async function handleConnectWallet() {
    if (!window.ethereum) { alert(t('installMetamask')); return; }
    setWalletLoading(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [WALLET_SIGN_MESSAGE, address] });
      await apiConnectWallet({ address, signature });
      setWalletAddress(address);
    } catch { /* user rejected */ }
    setWalletLoading(false);
  }

  async function handleDisconnectWallet() {
    await apiDisconnectWallet();
    setWalletAddress(null);
  }

  if (!ready) return <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800/50 px-4 py-3 h-[52px]" />;
  const statusColor = status === 'running' ? 'bg-green-500' : status === 'paused' ? 'bg-yellow-500' : 'bg-red-500';
  const statusGlow = status === 'running' ? 'shadow-green-500/30' : status === 'paused' ? 'shadow-yellow-500/30' : 'shadow-red-500/30';

  const eyeToggle = (
    <button
      type="button"
      onClick={toggleBalancesHidden}
      title={balancesHidden ? t('showBalances') : t('hideBalances')}
      aria-label={balancesHidden ? t('showBalances') : t('hideBalances')}
      className="text-gray-400 hover:text-white transition-colors p-1 shrink-0"
    >
      {balancesHidden ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      )}
    </button>
  );

  const equityText = !portfolioLoaded
    ? <span className="text-gray-500 text-xs animate-pulse" aria-label={t('loading')}>—</span>
    : maskAmount(`$${(totalEquity || totalBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, balancesHidden);
  const availableText = !portfolioLoaded
    ? <span className="text-gray-500 text-xs animate-pulse" aria-label={t('loading')}>—</span>
    : maskAmount(`$${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, balancesHidden);
  const dailyText = maskAmount(`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`, balancesHidden);

  return (<>
    <header className="relative z-50 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800/50 px-4 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto gap-2">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor} shadow-lg ${statusGlow}`} />
          <span className="text-sm font-medium uppercase">{t(status)}</span>
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${mode === 'live' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
            {t(mode)}
          </span>
          {mode === 'live' && testnet && (
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              {t('testnet')}
            </span>
          )}
          {demo && (
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              {t('demoMode')}
            </span>
          )}
          {secondsLeft !== null && (
            <span className="text-xs text-gray-400 font-mono bg-gray-800/50 px-2 py-0.5 rounded-md">{secondsLeft}s</span>
          )}
        </div>

        {/* Desktop balance: stacked 3 lines at the right edge of the header */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="text-end">
            <div className="text-sm font-mono font-semibold" title={t('totalEquityTooltip')}>{equityText}</div>
            <div className="text-[10px] font-mono text-gray-400" title={t('availableUsdtTooltip')}>
              {!portfolioLoaded ? availableText : <>{availableText} {t('availableUsdt')}</>}
            </div>
            <div className={`text-xs font-mono ${dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`} title={t('dailyPnlTooltip')}>
              {dailyText} / {t('daily')}
            </div>
          </div>
          {eyeToggle}
        </div>

        <div className="flex items-center gap-2">
          {/* Wallet */}
          {!demo && isEnabled('connectWallet') && (
            walletAddress ? (
              <button onClick={handleDisconnectWallet} className="relative flex items-center gap-1.5 text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2.5 py-1.5 rounded-lg hover:bg-green-500/20 transition-colors" title={walletAddress}>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <span className="font-mono">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
              </button>
            ) : (
              <button onClick={() => setShowWalletModal(true)} className="relative flex items-center gap-1.5 text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2.5 py-1.5 rounded-lg hover:text-purple-400 hover:border-purple-500/30 transition-colors">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span>{t('connectWallet')}</span>
              </button>
            )
          )}

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm text-white font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 active:scale-95 active:shadow-blue-500/40 transition-all uppercase"
            >
              {username?.charAt(0) || '?'}
            </button>
            {menuOpen && (
              <div className="absolute end-0 top-11 bg-gray-900 border border-gray-700/50 rounded-xl shadow-2xl py-1.5 w-52 z-50 backdrop-blur-sm">
                <div className="px-4 py-2 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm text-white font-medium uppercase shrink-0">{username?.charAt(0) || '?'}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{username}</div>
                    {email && <div className="text-xs text-gray-500 truncate">{email}</div>}
                  </div>
                </div>
                <div className="border-t border-gray-800/50 my-1" />
                <button
                  onClick={() => { navigate('/settings'); setMenuOpen(false); }}
                  className="w-full text-start px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 active:bg-gray-800 hover:text-white active:text-white transition-colors rounded-lg mx-0"
                >
                  {t('settings')}
                </button>
                <div className="border-t border-gray-800/50 my-1" />
                <button
                  onClick={() => { logout(); navigate('/login', { replace: true }); }}
                  className="w-full text-start px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 active:bg-red-500/10 transition-colors rounded-lg"
                >
                  {t('logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Mobile-only second row: the three balance figures rendered inline,
          side-by-side, so a phone-width viewport shows a single compact row
          (Equity · Available · Daily) instead of a stacked trio. */}
      <div className="sm:hidden flex items-center justify-center gap-3 max-w-7xl mx-auto mt-2 flex-wrap">
        <span className="text-sm font-mono font-semibold" title={t('totalEquityTooltip')}>{equityText}</span>
        <span className="text-[10px] font-mono text-gray-400" title={t('availableUsdtTooltip')}>
          {!portfolioLoaded ? availableText : <>{availableText} {t('availableUsdt')}</>}
        </span>
        <span className={`text-xs font-mono ${dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`} title={t('dailyPnlTooltip')}>
          {dailyText} / {t('daily')}
        </span>
        {eyeToggle}
      </div>
    </header>

    {/* Wallet Connect Modal */}
    {showWalletModal && (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={() => setShowWalletModal(false)}>
        <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-white">{t('connectWallet')}</h3>
            <button onClick={() => setShowWalletModal(false)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="space-y-2">
            <button
              onClick={async () => {
                setShowWalletModal(false);
                await handleConnectWallet();
              }}
              disabled={walletLoading}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-800 bg-gray-800/50 hover:bg-gray-800 hover:border-gray-700 transition-all disabled:opacity-50"
            >
              <svg className="w-8 h-8 shrink-0" viewBox="0 0 35 33" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M32.96 1l-13.14 9.72 2.45-5.73L32.96 1z" fill="#E2761B" stroke="#E2761B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2.66 1l13.02 9.82L13.35 4.99 2.66 1zM28.23 23.53l-3.5 5.34 7.49 2.06 2.15-7.28-6.14-.12zM1.27 23.65l2.14 7.28 7.49-2.06-3.5-5.34-6.13.12z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10.47 14.51l-2.09 3.15 7.44.33-.26-7.99-5.09 4.51zM25.18 14.51l-5.17-4.6-.17 8.08 7.43-.33-2.09-3.15zM10.87 28.87l4.49-2.16-3.88-3.02-.61 5.18zM20.29 26.71l4.49 2.16-.6-5.18-3.89 3.02z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M24.78 28.87l-4.49-2.16.36 2.92-.04 1.23 4.17-1.99zM10.87 28.87l4.17 1.99-.03-1.23.35-2.92-4.49 2.16z" fill="#D7C1B3" stroke="#D7C1B3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15.09 21.78l-3.74-1.1 2.64-1.21 1.1 2.31zM20.56 21.78l1.1-2.31 2.65 1.21-3.75 1.1z" fill="#233447" stroke="#233447" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10.87 28.87l.63-5.34-4.13.12 3.5 5.22zM24.15 23.53l.63 5.34 3.5-5.22-4.13-.12zM27.27 17.66l-7.43.33.69 3.79 1.1-2.31 2.65 1.21 2.99-3.02zM11.35 20.68l2.64-1.21 1.1 2.31.69-3.79-7.44-.33 2.99 3.02z" fill="#CD6116" stroke="#CD6116" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="text-start">
                <p className="text-sm font-medium text-white">MetaMask</p>
                <p className="text-[11px] text-gray-500">{walletLoading ? t('loading') : t('walletSignMessage')}</p>
              </div>
            </button>

            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-800/50 bg-gray-800/20 opacity-40 cursor-not-allowed">
              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs font-bold shrink-0">W</div>
              <div className="text-start">
                <p className="text-sm font-medium text-gray-500">WalletConnect</p>
                <p className="text-[11px] text-gray-600">{t('comingSoon')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-800/50 bg-gray-800/20 opacity-40 cursor-not-allowed">
              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs font-bold shrink-0">C</div>
              <div className="text-start">
                <p className="text-sm font-medium text-gray-500">Coinbase Wallet</p>
                <p className="text-[11px] text-gray-600">{t('comingSoon')}</p>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-600 text-center mt-4">
            {t('byUsing')} <a href="/terms" className="text-blue-400 hover:underline">{t('termsOfService')}</a> {t('and')} <a href="/privacy" className="text-blue-400 hover:underline">{t('privacyPolicy')}</a>
          </p>
        </div>
      </div>
    )}
    </>
  );
}
