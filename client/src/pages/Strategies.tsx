// client/src/pages/Strategies.tsx
import { useEffect } from 'react';
import { getStrategies, toggleStrategy } from '../lib/api';
import { useBotStore } from '../stores/bot';
import { useLanguageStore } from 'common';

const STRATEGY_COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  ma_crossover: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', accent: 'text-blue-400' },
  rsi:          { bg: 'bg-purple-500/5', border: 'border-purple-500/20', accent: 'text-purple-400' },
  macd:         { bg: 'bg-cyan-500/5', border: 'border-cyan-500/20', accent: 'text-cyan-400' },
  bollinger:    { bg: 'bg-amber-500/5', border: 'border-amber-500/20', accent: 'text-amber-400' },
  wyckoff:      { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', accent: 'text-emerald-400' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-800/50', border: 'border-gray-800', accent: 'text-gray-400' };

export function Strategies() {
  const { strategies, setStrategies } = useBotStore();
  const { t } = useLanguageStore();

  useEffect(() => {
    getStrategies().then(setStrategies);
  }, []);

  async function handleToggle(id: string) {
    const updated = await toggleStrategy(id);
    setStrategies(strategies.map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('strategies')}</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">
          {strategies.filter((s) => s.enabled).length} / {strategies.length}
        </span>
      </div>

      {strategies.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center py-12 text-gray-600">
          <div className="relative mb-3 animate-float">
            <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="absolute inset-0 rounded-full bg-gray-500/10 animate-pulse-ring" />
          </div>
          <p className="text-sm">{t('noStrategies')}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {strategies.map((s) => {
            const colors = STRATEGY_COLORS[s.id] || DEFAULT_COLOR;
            return (
              <div
                key={s.id}
                className={`rounded-xl p-4 border transition-all ${
                  s.enabled
                    ? `${colors.bg} ${colors.border}`
                    : 'bg-gray-900 border-gray-800/50 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className={`font-semibold ${s.enabled ? colors.accent : 'text-gray-400'}`}>
                        {t(s.id as any) || s.name}
                      </span>
                      {s.enabled && (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-400">
                          {t('active')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">{t('interval')}:</span>
                        <span className="bg-gray-800 px-2 py-0.5 rounded-md font-mono text-gray-300">{s.interval}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">{t('market')}:</span>
                        <span className="bg-gray-800 px-2 py-0.5 rounded-md text-gray-300">{t(s.marketType as 'spot' | 'futures')}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(s.params).map(([k, v]) => {
                        const desc = t(`paramDesc_${k}` as any);
                        const hasDesc = desc && desc !== `paramDesc_${k}`;
                        return (
                          <span
                            key={k}
                            className="relative group text-[11px] bg-gray-800/80 text-gray-400 px-2 py-0.5 rounded-md font-mono cursor-help"
                          >
                            {t(k as any) || k}={String(v)}
                            {hasDesc && (
                              <span
                                role="tooltip"
                                className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 max-w-[16rem] px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-[11px] leading-snug text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-xl whitespace-normal text-center font-sans"
                              >
                                {desc}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggle(s.id)}
                    className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ml-4 ${s.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                    dir="ltr"
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${s.enabled ? 'left-[26px]' : 'left-0.5'}`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
