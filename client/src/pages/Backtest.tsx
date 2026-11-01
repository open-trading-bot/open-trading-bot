// client/src/pages/Backtest.tsx
import { useState, useRef, useEffect } from 'react';
import { runBacktest, getSymbols } from '../lib/api';
import { createChart, LineSeries, type IChartApi } from 'lightweight-charts';
import { CryptoIcon, useLanguageStore, useThemeStore } from 'common';
import { useBotStore } from '../stores/bot';

interface BacktestResult {
  trades: { entryPrice: number; exitPrice: number; side: string; pnl: number; pnlPct: number; entryTime: number; exitTime: number }[];
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  equity: { timestamp: number; value: number }[];
}

export function Backtest() {
  const { backtestResult, backtestParams, setBacktestResult } = useBotStore();
  const [symbol, setSymbol] = useState(backtestParams?.symbol ?? 'BTC/USDT');
  const [strategy, setStrategy] = useState(backtestParams?.strategy ?? 'ma_crossover');
  const [interval, setInterval] = useState(backtestParams?.interval ?? '1h');
  const [loading, setLoading] = useState(false);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const result = backtestResult as BacktestResult | null;

  useEffect(() => {
    getSymbols().then(setAllSymbols).catch(() => {});
  }, []);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const { t } = useLanguageStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  async function handleRun() {
    setLoading(true);
    const data = await runBacktest({ symbol, strategy, interval });
    setBacktestResult(data, { symbol, strategy, interval });
    setLoading(false);
  }

  useEffect(() => {
    if (!result || !chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.remove();
    }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 320,
      layout: { background: { color: isDark ? '#0d1117' : '#ffffff' }, textColor: isDark ? '#6B7280' : '#94a3b8' },
      grid: { vertLines: { color: isDark ? '#1F2937' : '#f1f5f9' }, horzLines: { color: isDark ? '#1F2937' : '#f1f5f9' } },
      rightPriceScale: { borderColor: isDark ? '#1F2937' : '#e2e8f0' },
      timeScale: { borderColor: isDark ? '#1F2937' : '#e2e8f0' },
    });

    const lineColor = result.totalReturn >= 0 ? '#22C55E' : '#EF4444';
    const series = chart.addSeries(LineSeries, {
      color: lineColor,
      lineWidth: 2,
    });
    series.setData(
      result.equity.map((e) => ({
        time: (e.timestamp / 1000) as any,
        value: e.value,
      })),
    );

    chart.timeScale().fitContent();
    chartInstance.current = chart;

    const handleResize = () => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartInstance.current = null;
    };
  }, [result, theme]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-medium">{t('backtest')}</h2>
        <p className="text-xs text-gray-500 mt-1">{t('backtestDesc')}</p>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800/50">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">{t('symbol')}</label>
            <div className="flex items-center gap-2">
              <CryptoIcon symbol={symbol} size={20} />
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none"
              >
                {(() => {
                  const TOP = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'DOT/USDT', 'LINK/USDT'];
                  const topAvailable = TOP.filter((s) => allSymbols.includes(s));
                  const rest = allSymbols.filter((s) => !TOP.includes(s));
                  if (allSymbols.length === 0) return <option value={symbol}>{symbol}</option>;
                  return (
                    <>
                      <optgroup label="Popular">
                        {topAvailable.map((s) => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                      <optgroup label="All">
                        {rest.map((s) => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    </>
                  );
                })()}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">{t('strategy')}</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none">
              <option value="ma_crossover">{t('ma_crossover')}</option>
              <option value="rsi">{t('rsi')}</option>
              <option value="macd">{t('macd')}</option>
              <option value="bollinger">{t('bollinger')}</option>
              <option value="wyckoff">{t('wyckoff')}</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">{t('interval')}</label>
            <select value={interval} onChange={(e) => setInterval(e.target.value)} className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none">
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm px-5 py-2 rounded-lg font-medium transition-all shadow-lg shadow-blue-600/20 disabled:shadow-none"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                {t('runningBacktest')}
              </span>
            ) : t('runBacktest')}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Chart */}
          <div ref={chartRef} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800/50" />

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: t('totalReturn'), value: `$${result.totalReturn.toFixed(2)}`, color: result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: t('winRate'), value: `${result.winRate.toFixed(1)}%`, color: result.winRate >= 50 ? 'text-green-400' : 'text-yellow-400' },
              { label: t('maxDrawdown'), value: `${result.maxDrawdown.toFixed(2)}%`, color: 'text-red-400' },
              { label: t('trades'), value: `${result.trades.length}`, color: '' },
            ].map((stat) => (
              <div key={stat.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800/50">
                <div className="mb-2">
                  <span className="text-[11px] text-gray-500 uppercase tracking-wide">{stat.label}</span>
                </div>
                <div className={`text-xl font-mono font-semibold ${stat.color}`}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Trade List */}
          <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800/50">
              <h3 className="text-sm font-medium text-gray-400">{t('backtestTrades')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                    <th className="text-start py-3 px-4">{t('side')}</th>
                    <th className="text-end py-3 px-4">{t('entry')}</th>
                    <th className="text-end py-3 px-4">{t('exit')}</th>
                    <th className="text-end py-3 px-4">{t('pnl')}</th>
                    <th className="text-end py-3 px-4">{t('pnlPct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((tr, i) => (
                    <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                      <td className="py-2.5 px-4">
                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${tr.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          {t(tr.side as 'buy' | 'sell')}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono text-gray-300">${tr.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-end font-mono text-gray-300">${tr.exitPrice.toFixed(2)}</td>
                      <td className={`py-2.5 px-4 text-end font-mono font-semibold ${tr.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${tr.pnl.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-4 text-end font-mono ${tr.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tr.pnlPct >= 0 ? '+' : ''}{tr.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
      {!result && !loading && (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center py-16 text-gray-600">
          <div className="relative mb-4 animate-float">
            <svg className="w-12 h-12 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-pulse-ring" />
          </div>
          <p className="text-sm mb-1">{t('backtest')}</p>
          <p className="text-xs text-gray-700">{t('backtestEmpty')}</p>
        </div>
      )}
    </div>
  );
}
