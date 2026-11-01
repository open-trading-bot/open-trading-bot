// client/src/pages/Settings.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getStatus, updateConfig, getSymbols, getExchangeKeys, updateExchangeKeys, verifyExchangeKeys, updateExchangeTestnet, updatePreferences, killBot, getPortfolioBalance, checkExchangeKeyPermissions, invalidateExchangeKeyCheckCache, getVersion } from '../lib/api';
import { useShallow } from 'zustand/react/shallow';
import { useBotStore } from '../stores/bot';
import { useThemeStore, useLanguageStore, useAuthStore, languages, type Language, CryptoIcon } from 'common';

type RiskLevel = 'conservative' | 'moderate' | 'aggressive' | 'very-aggressive' | 'extreme' | 'custom';

const RISK_LEVEL_PCTS: Record<Exclude<RiskLevel, 'custom'>, { tradeAmountPct: number; stopLossPct: number; dailyLossLimitPct: number; maxOpenPositions: number; minConfidence: number }> = {
  conservative:      { tradeAmountPct: 0.5,  stopLossPct: 1,  dailyLossLimitPct: 2,   maxOpenPositions: 3,  minConfidence: 0.7 },
  moderate:          { tradeAmountPct: 1,    stopLossPct: 2,  dailyLossLimitPct: 5,   maxOpenPositions: 5,  minConfidence: 0.5 },
  aggressive:        { tradeAmountPct: 2.5,  stopLossPct: 3,  dailyLossLimitPct: 10,  maxOpenPositions: 10, minConfidence: 0.3 },
  'very-aggressive': { tradeAmountPct: 5,    stopLossPct: 5,  dailyLossLimitPct: 25,  maxOpenPositions: 15, minConfidence: 0.2 },
  extreme:           { tradeAmountPct: 10,   stopLossPct: 8,  dailyLossLimitPct: 50,  maxOpenPositions: 25, minConfidence: 0.1 },
};

function getRiskPreset(level: Exclude<RiskLevel, 'custom'>, balance: number) {
  const p = RISK_LEVEL_PCTS[level];
  return {
    tradeAmount: Math.max(1, Math.round(balance * p.tradeAmountPct / 100)),
    stopLossPct: p.stopLossPct,
    dailyLossLimit: Math.max(1, Math.round(balance * p.dailyLossLimitPct / 100)),
    maxOpenPositions: p.maxOpenPositions,
    minConfidence: p.minConfidence,
  };
}

const RISK_LEVELS: Exclude<RiskLevel, 'custom'>[] = ['conservative', 'moderate', 'aggressive', 'very-aggressive', 'extreme'];

const RISK_LEVEL_META: Record<Exclude<RiskLevel, 'custom'>, { label: string; descKey: string; color: string; bgSelected: string; borderSelected: string; barColor: string; barWidth: string }> = {
  conservative:      { label: 'conservative',  descKey: 'riskLevelDesc_conservative',  color: 'text-green-400',  bgSelected: 'bg-green-500/10',  borderSelected: 'border-green-500/50',  barColor: 'bg-green-500',  barWidth: 'w-1/5' },
  moderate:          { label: 'moderate',       descKey: 'riskLevelDesc_moderate',       color: 'text-blue-400',   bgSelected: 'bg-blue-500/10',   borderSelected: 'border-blue-500/50',   barColor: 'bg-blue-500',   barWidth: 'w-2/5' },
  aggressive:        { label: 'aggressive',     descKey: 'riskLevelDesc_aggressive',     color: 'text-yellow-400', bgSelected: 'bg-yellow-500/10', borderSelected: 'border-yellow-500/50', barColor: 'bg-yellow-500', barWidth: 'w-3/5' },
  'very-aggressive': { label: 'veryAggressive', descKey: 'riskLevelDesc_veryAggressive', color: 'text-orange-400', bgSelected: 'bg-orange-500/10', borderSelected: 'border-orange-500/50', barColor: 'bg-orange-500', barWidth: 'w-4/5' },
  extreme:           { label: 'extreme',        descKey: 'riskLevelDesc_extreme',        color: 'text-red-400',    bgSelected: 'bg-red-500/10',    borderSelected: 'border-red-500/50',    barColor: 'bg-red-500',    barWidth: 'w-full' },
};

interface Config {
  mode: string;
  riskLevel: RiskLevel;
  tradeAmount: number;
  stopLossPct: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  minConfidence: number;
  tickInterval: number;
  orderType: string;
  assets: { symbol: string; enabled: boolean; marketType: string }[];
}

export function Settings() {
  const { theme, toggleTheme } = useThemeStore();
  const { lang, setLang, t } = useLanguageStore();
  const { isDemo } = useAuthStore();
  const demo = isDemo();
  const [config, setConfig] = useState<Config | null>(null);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ step: number; total: number; label: string } | null>(null);
  const [newAsset, setNewAsset] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { setTickInterval, setMode, setTestnet, totalBalance, status, setStatus, positions, setPositions, setPortfolio, setKeyReadOnly, keyReadOnly: storeKeyReadOnly } = useBotStore(useShallow((s) => ({ setTickInterval: s.setTickInterval, setMode: s.setMode, setTestnet: s.setTestnet, totalBalance: s.totalBalance, status: s.status, setStatus: s.setStatus, positions: s.positions, setPositions: s.setPositions, setPortfolio: s.setPortfolio, setKeyReadOnly: s.setKeyReadOnly, keyReadOnly: s.keyReadOnly })));
  const [showStopBotModal, setShowStopBotModal] = useState(false);
  const [exchangeKeys, setExchangeKeys] = useState<{ hasKeys: boolean; testnet: boolean; keyHint: string; secretHint: string }>({ hasKeys: false, testnet: true, keyHint: '', secretHint: '' });
  const [keyPermissions, setKeyPermissions] = useState<{ checked: boolean; readOnly: boolean; canTrade: boolean } | null>(null);
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newTestnet, setNewTestnet] = useState(true);
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState('bybit');
  const [savedExchange, setSavedExchange] = useState('bybit');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; balance?: number; error?: string } | null>(null);
  const [keyFocused, setKeyFocused] = useState(false);
  const [secretFocused, setSecretFocused] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [assetCloseConfirm, setAssetCloseConfirm] = useState<{
    update: Partial<Config>;
    affectedSymbols: string[];
    positions: any[];
  } | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getStatus(),
      getPortfolioBalance().catch(() => null),
    ]).then(([data, balance]: [{ config: Config }, any]) => {
      const persisted = data.config;
      let displayed = persisted;
      if (balance && persisted.riskLevel !== 'custom') {
        const preset = getRiskPreset(persisted.riskLevel, balance.totalBalance);
        if (preset.tradeAmount !== persisted.tradeAmount || preset.dailyLossLimit !== persisted.dailyLossLimit) {
          displayed = { ...persisted, ...preset };
        }
      }
      if (balance) {
        setPortfolio({ totalBalance: balance.totalBalance, availableBalance: balance.availableBalance, totalEquity: balance.totalEquity ?? balance.totalBalance });
      }
      setConfig(displayed);
      // Use `displayed` as the baseline so balance-driven preset recalculation
      // doesn't register as a user edit (otherwise hasChanges is true on load
      // and any nav click triggers the unsaved-changes modal).
      setSavedConfig(displayed);
    });
    getSymbols().then(setAllSymbols).catch(() => {});
    getVersion().then((v) => { if (v?.version && v.version !== 'unknown') setRuntimeVersion(v.version); }).catch(() => {});
    getExchangeKeys().then((keys: any) => {
      setExchangeKeys(keys);
      setNewTestnet(keys.testnet);
      if (keys.exchange) { setSelectedExchange(keys.exchange); setSavedExchange(keys.exchange); }
      // If we have saved keys, also check the permissions in the background.
      // This catches users who saved a read-only key before verify-time
      // detection existed (like user 3) and surfaces a persistent warning
      // in the UI so they know they need to re-generate the key.
      // Only call the server check if we don't already have the answer in
      // the store (populated by a previous mount on this or another page).
      // This matters under React strict-mode double-mount and HMR, and
      // after page navigation within the same session. Users can force a
      // refresh by reloading the tab.
      if (keys.hasKeys) {
        if (storeKeyReadOnly !== null) {
          // Already known — hydrate local UI state from the store.
          setKeyPermissions({ checked: true, readOnly: storeKeyReadOnly, canTrade: !storeKeyReadOnly });
        } else {
          checkExchangeKeyPermissions().then((res: any) => {
            if (res?.checked) {
              const isReadOnly = !!res.readOnly || !res.canTrade;
              setKeyPermissions({ checked: true, readOnly: !!res.readOnly, canTrade: !!res.canTrade });
              setKeyReadOnly(isReadOnly);
            }
          }).catch(() => {});
        }
      } else {
        setKeyReadOnly(null);
      }
    }).catch(() => {});
  }, []);

  const [pendingTestnet, setPendingTestnet] = useState<boolean | null>(null);
  const testnetChanged = pendingTestnet !== null && pendingTestnet !== exchangeKeys.testnet;
  const hasChanges = (config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig)) || testnetChanged;
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Block browser tab close/refresh
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // Intercept in-app navigation via click events on links
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href === location.pathname || href.startsWith('http')) return;
      // Links that open in a new tab or with a modifier key don't unload
      // the current page, so unsaved changes are not at risk.
      if (anchor.target === '_blank') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingPath(href);
      setShowUnsavedModal(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [hasChanges, location.pathname]);

  function affectedStoppedSymbols(update: Partial<Config>): string[] {
    if (!update.assets || !savedConfig) return [];
    const nextEnabled = new Set(update.assets.filter((a) => a.enabled).map((a) => a.symbol));
    return savedConfig.assets
      .filter((a) => a.enabled && !nextEnabled.has(a.symbol))
      .map((a) => a.symbol);
  }

  function saveWithAssetGuard(update: Partial<Config>) {
    const stopped = affectedStoppedSymbols(update);
    if (stopped.length === 0) {
      save(update);
      return;
    }
    const affected = positions.filter((p: any) => stopped.includes(p.symbol));
    if (affected.length === 0) {
      save(update);
      return;
    }
    setAssetCloseConfirm({ update, affectedSymbols: stopped, positions: affected });
  }

  async function save(update: Partial<Config>) {
    setSaving(true);
    setError(null);
    const modeOrTestnetChanged = update.mode !== savedConfig?.mode || testnetChanged;
    const targetMode = update.mode ?? savedConfig?.mode;
    const showProgress = modeOrTestnetChanged && targetMode === 'live';
    const totalSteps = showProgress ? 3 : 0;
    try {
      if (showProgress) setSaveProgress({ step: 1, total: totalSteps, label: t('saveStepConfig') });
      const result = await updateConfig(update);
      setConfig(result);
      setSavedConfig(result);
      if (update.tickInterval) setTickInterval(update.tickInterval);
      if (result.mode) setMode(result.mode);
      if (Array.isArray((result as any).closedPositions) && (result as any).closedPositions.length > 0) {
        // Server auto-closed positions on disabled/removed assets. Drop them
        // from the local store so the UI matches the server's new truth.
        const closedIds = new Set((result as any).closedPositions.map((p: any) => p.id));
        setPositions(positions.filter((p: any) => !closedIds.has(p.id)));
      }

      if (modeOrTestnetChanged) {
        if (showProgress) setSaveProgress({ step: 2, total: totalSteps, label: t('saveStepPortfolio') });
        const balance = await getPortfolioBalance();
        setPortfolio({ totalBalance: balance.totalBalance, availableBalance: balance.availableBalance, totalEquity: balance.totalEquity ?? balance.totalBalance });

        if (result.riskLevel !== 'custom') {
          if (showProgress) setSaveProgress({ step: 3, total: totalSteps, label: t('saveStepPreset') });
          const preset = getRiskPreset(result.riskLevel, balance.totalBalance);
          const updated = { ...result, ...preset };
          const saved = await updateConfig(updated);
          setConfig(saved);
          setSavedConfig(saved);
        }
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      setError(msg.includes('not found') ? t('invalidSymbol') : msg);
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  }

  const balanceExceeded = config ? (config.tradeAmount > totalBalance || config.dailyLossLimit > totalBalance) : false;

  function closeLiveModal() {
    setShowLiveModal(false);
    setSelectedExchange(savedExchange);
    setNewApiKey('');
    setNewApiSecret('');
    setVerifyResult(null);
    setKeysError(null);
  }

  const needsBotStop = status === 'running' && config && savedConfig &&
    (config.mode !== savedConfig.mode || config.riskLevel !== savedConfig.riskLevel || testnetChanged);

  async function saveTestnetIfChanged() {
    if (pendingTestnet !== null && pendingTestnet !== exchangeKeys.testnet) {
      await updateExchangeTestnet(pendingTestnet);
      setExchangeKeys({ ...exchangeKeys, testnet: pendingTestnet });
      setTestnet(pendingTestnet);
      setPendingTestnet(null);
    }
  }

  async function saveAll() {
    if (!config || balanceExceeded) return;
    if (needsBotStop) {
      setShowStopBotModal(true);
      return;
    }
    await saveTestnetIfChanged();
    await save(config);
  }

  async function confirmStopAndSave() {
    if (!config) return;
    setShowStopBotModal(false);
    setSaving(true);
    try {
      const result = await killBot();
      setStatus(result.status);
      setPositions([]);
      await saveTestnetIfChanged();
      await save(config);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  }

  if (!config) return <div className="text-gray-500">{t('loading')}</div>;

  const activeLevel = config.riskLevel !== 'custom' ? RISK_LEVEL_META[config.riskLevel] : null;

  return (
    <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('settings')}</h2>
        <button
          onClick={saveAll}
          disabled={!hasChanges || saving || balanceExceeded}
          className={`text-sm px-4 py-2 rounded-lg font-medium transition-all ${hasChanges ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>

      {saveProgress && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-blue-300">{saveProgress.label}</span>
            <span className="text-[10px] font-mono text-blue-400/70">{saveProgress.step} / {saveProgress.total}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-blue-500/10 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${(saveProgress.step / saveProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {demo && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400">{t('demoLiveRestricted')}</p>
        </div>
      )}

      {/* Risk Level Selector */}
      <section className="bg-gray-900 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-400">{t('riskLevel')}</h3>
          {config.riskLevel === 'custom' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">{t('custom')}</span>
          )}
        </div>

        {config.mode === 'live' && totalBalance === 0 && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
            <p className="text-xs text-yellow-400">{t('zeroBalanceRiskNote')}</p>
          </div>
        )}

        {/* Risk Meter Bar */}
        <div className="space-y-2">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ease-out ${activeLevel ? `${activeLevel.barColor} ${activeLevel.barWidth}` : 'bg-yellow-500 w-1/2'}`} />
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 px-0.5">
            <span>{t('conservative')}</span>
            <span>{t('extreme')}</span>
          </div>
        </div>

        {/* Level Cards */}
        <div className="grid grid-cols-5 gap-2">
          {RISK_LEVELS.map((level) => {
            const meta = RISK_LEVEL_META[level];
            // Preview uses a fallback balance so the per-trade label stays informative
            // before the portfolio has loaded; the value actually applied on click
            // must be computed from the real balance so it can't exceed available funds.
            const preset = getRiskPreset(level, totalBalance || 10000);
            const applyPreset = getRiskPreset(level, totalBalance);
            const isActive = config.riskLevel === level;
            return (
              <button
                key={level}
                onClick={() => setConfig({ ...config, riskLevel: level, ...applyPreset })}
                className={`relative flex flex-col items-center gap-2 px-2 py-3 rounded-lg text-xs font-medium transition-all border ${
                  isActive
                    ? `${meta.bgSelected} ${meta.borderSelected} ${meta.color}`
                    : 'bg-gray-800/50 border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                <span className="font-semibold text-center leading-tight">{t(meta.label as any)}</span>
                <span className={`text-[10px] font-mono ${isActive ? 'opacity-80' : 'opacity-50'}`}>${preset.tradeAmount.toLocaleString()}/{t('perTrade' as any)}</span>
              </button>
            );
          })}
        </div>

        {/* Extreme Warning */}
        {config.riskLevel === 'extreme' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2.5">
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <p className="text-xs text-red-400">{t('riskLevelWarning_extreme' as any)}</p>
          </div>
        )}

        {/* Active Level Description & Preview */}
        {activeLevel && (
          <div className={`rounded-lg border ${activeLevel.borderSelected} ${activeLevel.bgSelected} p-3 space-y-2`}>
            <p className="text-xs text-gray-400">{t(activeLevel.descKey as any)}</p>
            <div className="grid grid-cols-5 gap-2 text-center">
              {[
                { label: t('tradeAmount'), value: `$${config.tradeAmount.toLocaleString()}` },
                { label: t('stopLoss'), value: `${config.stopLossPct}%` },
                { label: t('dailyLossLimit'), value: `$${config.dailyLossLimit.toLocaleString()}` },
                { label: t('maxOpenPositions'), value: `${config.maxOpenPositions}` },
                { label: t('minConfidence'), value: `${Math.round(config.minConfidence * 100)}%` },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[10px] text-gray-500 truncate">{item.label}</div>
                  <div className={`text-xs font-mono font-semibold mt-0.5 ${activeLevel.color}`}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Trading Configuration */}
      <section className="bg-gray-900 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-gray-400">{t('tradingConfiguration')}</h3>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('botMode')}</label>
          <div className="grid grid-cols-2 gap-2">
            {(['paper', 'live'] as const).filter((m) => !demo || m === 'paper').map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (m === 'live') {
                    setShowLiveModal(true);
                  } else {
                    // Note: do NOT clear exchange keys here. Keys are encrypted at
                    // rest and should persist across paper/live toggles so users
                    // can switch back to live without re-entering them. Clearing
                    // here previously caused data loss when a user toggled to
                    // paper and logged out without saving — keys were wiped on
                    // the server but mode was only changed locally, leaving the
                    // account in a broken state (mode=live + no keys).
                    setConfig({ ...config, mode: m });
                  }
                }}
                className={`py-2 rounded-lg text-sm font-medium transition-all border ${
                  config.mode === m
                    ? m === 'live'
                      ? 'bg-red-500/10 border-red-500/50 text-red-400'
                      : 'bg-blue-500/10 border-blue-500/50 text-blue-400'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {t(m)}
                {m === 'live' && exchangeKeys.hasKeys && config.mode === 'live' && (
                  <span className="ms-1.5 inline-block w-2 h-2 rounded-full bg-green-400" />
                )}
              </button>
            ))}
          </div>
          {config.mode === 'paper' && (
            <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 flex items-start gap-2">
              <svg className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-blue-300/90 leading-relaxed">{t('paperModeExplanation')}</p>
            </div>
          )}
          {config.mode === 'live' && exchangeKeys.hasKeys && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs text-gray-400">
                {savedExchange.charAt(0).toUpperCase() + savedExchange.slice(1)} {exchangeKeys.testnet ? `(${t('testnet')})` : ''}
              </span>
              <button onClick={() => setShowLiveModal(true)} className="text-[10px] text-blue-400 hover:text-blue-300 ms-1">
                {t('edit')}
              </button>
            </div>
          )}
          {config.mode === 'live' && !exchangeKeys.hasKeys && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-start gap-2">
              <span className="text-red-400 text-sm leading-none mt-0.5">⚠</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-red-400 mb-0.5">{t('liveMissingKeysTitle')}</p>
                <p className="text-xs text-red-300/80 leading-relaxed">{t('liveMissingKeysBody')}</p>
                <button
                  onClick={() => setShowLiveModal(true)}
                  className="mt-1.5 text-[10px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                >
                  {t('liveMissingKeysAction')}
                </button>
              </div>
            </div>
          )}
          {config.mode === 'live' && exchangeKeys.hasKeys && keyPermissions?.checked && (keyPermissions.readOnly || !keyPermissions.canTrade) && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-start gap-2">
              <span className="text-red-400 text-sm leading-none mt-0.5">⚠</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-red-400 mb-0.5">{t('liveReadOnlyKeyTitle')}</p>
                <p className="text-xs text-red-300/80 leading-relaxed">{t('liveReadOnlyKeyBody')}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => setShowLiveModal(true)}
                    className="text-[10px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                  >
                    {t('liveReadOnlyKeyAction')}
                  </button>
                  <a
                    href={`/help/testnet/${savedExchange}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] px-2 py-1 rounded bg-gray-800/60 hover:bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                  >
                    {t('howToFixIt')}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('tradeAmount')}</label>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                min={0}
                value={config.tradeAmount}
                onChange={(e) => setConfig({ ...config, tradeAmount: Number(e.target.value), riskLevel: 'custom' })}
                className={`bg-gray-800 text-white rounded-lg ps-7 pe-3 py-2 text-sm w-full border focus:outline-none transition-colors ${config.tradeAmount > totalBalance ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-blue-500'}`}
              />
            </div>
            {config.tradeAmount > totalBalance && (
              <p className="text-[10px] text-red-400 mt-1">{t('exceedsBalance' as any)}</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('stopLoss')}</label>
            <div className="relative">
              <input
                type="number"
                step="0.5"
                value={config.stopLossPct}
                onChange={(e) => setConfig({ ...config, stopLossPct: Number(e.target.value), riskLevel: 'custom' })}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('dailyLossLimit')}</label>
            <div className="relative">
              <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                min={0}
                value={config.dailyLossLimit}
                onChange={(e) => setConfig({ ...config, dailyLossLimit: Number(e.target.value), riskLevel: 'custom' })}
                className={`bg-gray-800 text-white rounded-lg ps-7 pe-3 py-2 text-sm w-full border focus:outline-none transition-colors ${config.dailyLossLimit > totalBalance ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-blue-500'}`}
              />
            </div>
            {config.dailyLossLimit > totalBalance && (
              <p className="text-[10px] text-red-400 mt-1">{t('exceedsBalance' as any)}</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('maxOpenPositions')}</label>
            <input
              type="number"
              value={config.maxOpenPositions}
              onChange={(e) => setConfig({ ...config, maxOpenPositions: Number(e.target.value), riskLevel: 'custom' })}
              className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('minConfidence')}</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                value={Math.round(config.minConfidence * 100)}
                onChange={(e) => setConfig({ ...config, minConfidence: Number(e.target.value) / 100, riskLevel: 'custom' })}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('tickInterval')}</label>
            <div className="relative">
              <input
                type="number"
                min="10"
                value={config.tickInterval}
                onChange={(e) => setConfig({ ...config, tickInterval: Number(e.target.value) })}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
              />
              <span className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">s</span>
            </div>
          </div>
        </div>
      </section>

      {/* Assets */}
      <section className="bg-gray-900 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-gray-400">{t('assets')}</h3>
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-center justify-between">
            <p className="text-xs text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-sm ms-2">×</button>
          </div>
        )}
        <div className="space-y-2">
          {config.assets.map((asset, i) => (
            <div key={asset.symbol} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2.5 border border-gray-800">
              <div className="flex items-center gap-3">
                <CryptoIcon symbol={asset.symbol} size={22} />
                <span className="text-sm font-medium">{asset.symbol}</span>
                <span className="text-xs text-gray-400 bg-gray-700/60 rounded-md px-2 py-1 border border-gray-600">
                  {t('spot')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!asset.enabled && config.assets.filter((a) => a.enabled).length >= 10) {
                      setError(t('maxAssetsExceeded'));
                      return;
                    }
                    const updated = config.assets.map((a, j) => (j === i ? { ...a, enabled: !a.enabled } : a));
                    saveWithAssetGuard({ assets: updated } as any);
                  }}
                  className={`relative w-10 h-5 rounded-full transition-colors ${asset.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${asset.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                </button>
                <button
                  onClick={() => {
                    const updated = config.assets.filter((_, j) => j !== i);
                    saveWithAssetGuard({ assets: updated } as any);
                  }}
                  className="text-gray-600 hover:text-red-400 transition-colors ml-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <div className="relative flex-1">
            <input
              type="search"
              placeholder="BTC/USDT"
              autoComplete="off"
              value={newAsset}
              onChange={(e) => { setNewAsset(e.target.value.toUpperCase()); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
            />
            {showSuggestions && newAsset.length >= 1 && (() => {
              const existing = new Set(config.assets.map((a) => a.symbol));
              const filtered = allSymbols.filter((s) => s.includes(newAsset) && !existing.has(s)).slice(0, 8);
              if (filtered.length === 0) return null;
              return (
                <div className="absolute z-50 top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
                  {filtered.map((s) => (
                    <button
                      key={s}
                      onMouseDown={() => {
                        setNewAsset(s);
                        setShowSuggestions(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-start hover:bg-gray-800 transition-colors"
                    >
                      <CryptoIcon symbol={s} size={18} />
                      <span>{s}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <span className="bg-gray-800 text-gray-400 rounded-lg px-3 py-2 text-sm border border-gray-700">
            {t('spot')}
          </span>
          <button
            onClick={() => {
              if (!newAsset || !allSymbols.includes(newAsset)) {
                setError(t('invalidSymbol'));
                return;
              }
              if (config.assets.some((a) => a.symbol === newAsset)) return;
              if (config.assets.length >= 20) {
                setError(t('maxTotalAssetsExceeded'));
                return;
              }
              if (config.assets.filter((a) => a.enabled).length >= 10) {
                setError(t('maxAssetsExceeded'));
                return;
              }
              const updated = [...config.assets, { symbol: newAsset, enabled: true, marketType: 'spot' }];
              save({ assets: updated } as any);
              setNewAsset('');
            }}
            disabled={!newAsset || (allSymbols.length > 0 && !allSymbols.includes(newAsset))}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {t('add')}
          </button>
        </div>
      </section>

      {/* Asset-stop auto-close confirmation */}
      {assetCloseConfirm && (() => {
        const totalPnl = assetCloseConfirm.positions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        const count = assetCloseConfirm.positions.length;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setAssetCloseConfirm(null)}>
            <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-red-500/30 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('closeOpenPositionsTitle')}</h3>
                  <div className="text-xs text-gray-500 mt-0.5">{count} {t('openPositions')} · {assetCloseConfirm.affectedSymbols.join(', ')}</div>
                </div>
              </div>

              <div className={`rounded-xl p-4 mb-4 border ${totalPnl >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('estimatedPnl') || 'Estimated P&L'}</div>
                <div className={`text-2xl font-mono font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnl >= 0 ? '+' : '−'}${Math.abs(totalPnl).toFixed(2)}
                </div>
              </div>

              <div className="space-y-1.5 mb-5 max-h-48 overflow-y-auto">
                {assetCloseConfirm.positions.map((p: any) => (
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

              <p className="text-xs text-gray-500 mb-4">{t('closeOpenPositionsWarning')}</p>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setAssetCloseConfirm(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={() => {
                    const pending = assetCloseConfirm.update;
                    setAssetCloseConfirm(null);
                    save(pending);
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  {t('closeAndDisable')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unsaved Changes Modal */}
      {showStopBotModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-red-500/30 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">{t('botRunningWarning')}</h3>
            </div>
            <p className="text-sm text-gray-400 mb-5">{t('botRunningWarningMessage')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowStopBotModal(false)}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmStopAndSave}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                {t('stopAndSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnsavedModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 border border-gray-700/50 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">{t('unsavedChanges')}</h3>
            <p className="text-sm text-gray-400 mb-5">{t('unsavedChangesMessage')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowUnsavedModal(false); setPendingPath(null); }}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                {t('stayOnPage')}
              </button>
              <button
                onClick={() => { setShowUnsavedModal(false); if (pendingPath) navigate(pendingPath); setPendingPath(null); }}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              >
                {t('leaveWithoutSaving')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Mode Modal */}
      {showLiveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 overflow-y-auto p-4" onClick={() => closeLiveModal()}>
          <div className="bg-gray-900 rounded-2xl max-w-md w-full border border-gray-700/50 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-4 shrink-0 border-b border-gray-800/50">
              <h3 className="text-lg font-semibold text-white">{config.mode === 'live' ? t('liveSettings') : t('switchToLive')}</h3>
              <button onClick={() => closeLiveModal()} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6 pt-4">
              {/* Exchange Picker */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">{t('selectExchange')}</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'bybit', name: 'Bybit', available: true, logo: (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <path d="M5.5 5h4.8L7.1 14.6h4.3l1.1-3.4h-3.2L10.8 5H16l-3.2 9.6H6.2L5.5 5z" fill="currentColor"/>
                        <path d="M13.5 14.6h4.3L21 5h-4.8l-2.7 9.6z" fill="currentColor"/>
                        <path d="M7.7 16.2L6.5 19h10.8l1.2-2.8H7.7z" fill="currentColor"/>
                      </svg>
                    )},
                    { id: 'binance', name: 'Binance', available: true, logo: (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4l2.5 2.5-4.3 4.3-2.5-2.5L12 4zm5.8 5.8l2.5 2.5-2.5 2.5-2.5-2.5 2.5-2.5zM6.2 9.8l2.5 2.5-2.5 2.5-2.5-2.5 2.5-2.5zm5.8 2l2.5 2.5-4.3 4.3-2.5-2.5 4.3-4.3z" fill="currentColor"/>
                      </svg>
                    )},
                    { id: 'okx', name: 'OKX', available: false, logo: (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <rect x="4" y="4" width="6.5" height="6.5" rx="1" fill="currentColor"/>
                        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" fill="currentColor"/>
                        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" fill="currentColor"/>
                        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" fill="currentColor"/>
                      </svg>
                    )},
                  ].map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() => { if (!ex.available) return; setSelectedExchange(ex.id); setNewApiKey(''); setNewApiSecret(''); setVerifyResult(null); setKeysError(null); }}
                      disabled={!ex.available}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                        selectedExchange === ex.id
                          ? 'bg-blue-500/10 border-blue-500/50 text-blue-400'
                          : ex.available
                            ? 'bg-gray-800/50 border-gray-800 text-gray-400 hover:border-gray-700'
                            : 'bg-gray-800/20 border-gray-800/50 text-gray-600 cursor-not-allowed'
                      }`}
                    >
                      {ex.logo}
                      <span className="font-medium flex-1 text-start">{ex.name}</span>
                      {!ex.available && <span className="text-[10px] text-gray-600">{t('comingSoon')}</span>}
                      {selectedExchange === ex.id && <span className="w-2 h-2 rounded-full bg-blue-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exchange wallet note */}
              {(selectedExchange === 'bybit' || selectedExchange === 'binance') && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-300 mb-1">
                    {t('exchangeWalletsTitle')}
                  </p>
                  <p className="text-xs text-blue-200/80 leading-relaxed">
                    {selectedExchange === 'bybit' ? t('bybitWalletsBody') : t('binanceWalletsBody')}
                  </p>
                </div>
              )}

              {/* API Keys */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('apiKey')}</label>
                <div className="relative">
                  <input
                    type="text"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    placeholder={exchangeKeys.hasKeys && selectedExchange === savedExchange ? `••••••••${exchangeKeys.keyHint}` : t('enterApiKey')}
                    value={showApiKey || keyFocused ? newApiKey : (newApiKey ? '••••••••' + newApiKey.slice(-3) : '')}
                    onChange={(e) => { setNewApiKey(e.target.value); setVerifyResult(null); }}
                    onFocus={() => setKeyFocused(true)}
                    onBlur={() => setKeyFocused(false)}
                    className="bg-gray-800 text-white rounded-lg px-3 py-2 pe-9 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                  {newApiKey && (
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                      {showApiKey ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-3.12-3.12" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('apiSecret')}</label>
                <div className="relative">
                  <input
                    type="text"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    placeholder={exchangeKeys.hasKeys && selectedExchange === savedExchange ? `••••••••${exchangeKeys.secretHint}` : t('enterApiSecret')}
                    value={showApiSecret || secretFocused ? newApiSecret : (newApiSecret ? '••••••••' + newApiSecret.slice(-3) : '')}
                    onChange={(e) => { setNewApiSecret(e.target.value); setVerifyResult(null); }}
                    onFocus={() => setSecretFocused(true)}
                    onBlur={() => setSecretFocused(false)}
                    className="bg-gray-800 text-white rounded-lg px-3 py-2 pe-9 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                  {newApiSecret && (
                    <button type="button" onClick={() => setShowApiSecret(!showApiSecret)} className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                      {showApiSecret ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-3.12-3.12" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Testnet Toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('testnet')}</span>
                <button
                  onClick={() => { setNewTestnet(!newTestnet); setVerifyResult(null); }}
                  className={`relative w-10 h-5 rounded-full transition-colors ${newTestnet ? 'bg-green-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${newTestnet ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {newTestnet && !(exchangeKeys.hasKeys && exchangeKeys.testnet) && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                  <p className="text-xs text-yellow-400">
                    {t('testnetNote')}{' '}
                    <a
                      href={`/help/testnet/${selectedExchange}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-yellow-300"
                    >
                      {t('testnetLearnMore')}
                    </a>
                  </p>
                </div>
              )}
              {newTestnet !== exchangeKeys.testnet && exchangeKeys.hasKeys && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <p className="text-xs text-red-400">{t('testnetKeysRequired')}</p>
                </div>
              )}

              {/* Verify Result */}
              {verifyResult && (
                <div className={`rounded-lg border px-3 py-2 ${verifyResult.ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  {verifyResult.ok ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                      <p className="text-xs text-green-400">{t('connectionSuccess')} — {t('balance')}: ${verifyResult.balance?.toLocaleString()}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-red-400">{verifyResult.error}</p>
                  )}
                </div>
              )}

              {keysError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                  <p className="text-xs text-red-400">{keysError}</p>
                </div>
              )}

              {/* Going-live warning: bot will be stopped and open positions closed */}
              {(status === 'running' || positions.length > 0) && (
                <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2">
                  <p className="text-xs font-semibold text-orange-300 mb-0.5">
                    {t('goingLiveCleanupTitle')}
                  </p>
                  <p className="text-xs text-orange-200/80 leading-relaxed">
                    {t('goingLiveCleanupBody').replace('{count}', String(positions.length))}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!newApiKey || !newApiSecret) return;
                    setVerifying(true);
                    setVerifyResult(null);
                    try {
                      const result = await verifyExchangeKeys({ apiKey: newApiKey, apiSecret: newApiSecret, testnet: newTestnet, exchange: selectedExchange });
                      setVerifyResult({ ok: true, balance: result.balance });
                    } catch (err: any) {
                      setVerifyResult({ ok: false, error: err.response?.data?.error || err.message });
                    }
                    setVerifying(false);
                  }}
                  disabled={!newApiKey || !newApiSecret || verifying}
                  className={`flex-1 text-sm px-4 py-2.5 rounded-lg font-medium transition-all ${
                    newApiKey && newApiSecret ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {verifying ? t('verifying') : t('verifyConnection')}
                </button>
                <button
                  onClick={async () => {
                    const hasNewKeys = newApiKey && newApiSecret;
                    const needsCleanup = status === 'running' || positions.length > 0;
                    if (hasNewKeys) {
                      setSavingKeys(true);
                      setKeysError(null);
                      try {
                        if (needsCleanup) {
                          const killResult = await killBot();
                          setStatus(killResult.status);
                          setPositions([]);
                        }
                        const result = await updateExchangeKeys({ apiKey: newApiKey, apiSecret: newApiSecret, testnet: newTestnet, exchange: selectedExchange });
                        setExchangeKeys(result);
                        setSavedExchange(selectedExchange);
                        setTestnet(newTestnet);
                        setConfig({ ...config, mode: 'live' });
                        setNewApiKey('');
                        setNewApiSecret('');
                        setVerifyResult(null);
                        setShowLiveModal(false);
                        // The key changed — bust the permissions cache and
                        // reset the store flag so the next check reflects
                        // the new key. The save path already rejects
                        // read-only keys server-side, so setting canTrade
                        // state optimistically is safe.
                        invalidateExchangeKeyCheckCache();
                        setKeyPermissions({ checked: true, readOnly: false, canTrade: true });
                        setKeyReadOnly(false);
                      } catch (err: any) {
                        setKeysError(err.response?.data?.error || err.message);
                      }
                      setSavingKeys(false);
                    } else if (exchangeKeys.hasKeys) {
                      setSavingKeys(true);
                      setKeysError(null);
                      try {
                        if (needsCleanup) {
                          const killResult = await killBot();
                          setStatus(killResult.status);
                          setPositions([]);
                        }
                        if (newTestnet !== exchangeKeys.testnet) {
                          setPendingTestnet(newTestnet);
                        }
                        setConfig({ ...config, mode: 'live' });
                        setShowLiveModal(false);
                      } catch (err: any) {
                        setKeysError(err.response?.data?.error || err.message);
                      }
                      setSavingKeys(false);
                    }
                  }}
                  disabled={savingKeys || (selectedExchange !== savedExchange || newTestnet !== exchangeKeys.testnet ? !verifyResult?.ok : (newApiKey || newApiSecret ? !verifyResult?.ok : !exchangeKeys.hasKeys))}
                  className={`flex-1 text-sm px-4 py-2.5 rounded-lg font-medium transition-all ${
                    (selectedExchange !== savedExchange || newTestnet !== exchangeKeys.testnet ? verifyResult?.ok : (newApiKey || newApiSecret ? verifyResult?.ok : exchangeKeys.hasKeys)) ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {savingKeys ? t('saving') : (config.mode === 'live' ? t('updateSettings') : t('goLive'))}
                </button>
              </div>

              <p className="text-[10px] text-gray-600 text-center">{t('liveWarning')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Appearance */}
      <section className="bg-gray-900 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-gray-400">{t('appearance')}</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm">{t('theme')}</span>
          <button
            onClick={() => { toggleTheme(); const newTheme = theme === 'dark' ? 'light' : 'dark'; updatePreferences({ theme: newTheme }).catch(() => {}); }}
            className="bg-gray-800 text-sm px-4 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
          >
            {theme === 'dark' ? t('dark') : t('light')}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">{t('language')}</span>
          <select
            value={lang}
            onChange={(e) => { setLang(e.target.value as Language); updatePreferences({ lang: e.target.value }).catch(() => {}); }}
            className="bg-gray-800 text-sm rounded-lg px-4 py-1.5 border border-gray-700"
          >
            {Object.entries(languages).map(([code, { name }]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Version */}
      <div className="text-center">
        <span className="text-[10px] text-gray-600 font-mono">{t('version')} {runtimeVersion || __APP_VERSION__}</span>
      </div>
    </form>
  );
}
