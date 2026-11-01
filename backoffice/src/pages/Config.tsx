import { useEffect, useState } from 'react';
import { useLanguageStore } from 'common';
import { getStatus } from '../lib/api';

interface BotConfig {
  mode: string;
  riskLevel: string;
  tradeAmount: number;
  stopLossPct: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  minConfidence: number;
  tickInterval: number;
  assets: { symbol: string; enabled: boolean; marketType: string }[];
}

export function Config() {
  const { t } = useLanguageStore();
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStatus()
      .then((data) => { if (data.config) setConfig(data.config); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  if (!config) {
    return <p className="text-gray-500 text-sm">{t('boNoConfig')}</p>;
  }

  const rows: { label: string; value: string }[] = [
    { label: t('botMode'), value: config.mode.toUpperCase() },
    { label: t('riskLevel'), value: t(config.riskLevel as any) || config.riskLevel },
    { label: t('tradeAmount'), value: `$${config.tradeAmount}` },
    { label: t('stopLoss'), value: `${config.stopLossPct}%` },
    { label: t('dailyLossLimit'), value: `$${config.dailyLossLimit}` },
    { label: t('maxOpenPositions'), value: String(config.maxOpenPositions) },
    { label: t('minConfidence'), value: `${Math.round(config.minConfidence * 100)}%` },
    { label: t('tickInterval'), value: `${config.tickInterval}s` },
    { label: t('assets'), value: config.assets?.map((a) => `${a.symbol} (${a.marketType})`).join(', ') || '-' },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">{t('boConfig')}</h2>
      <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
        <table className="w-full">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-gray-800/30 last:border-0">
                <td className="text-sm text-gray-400 px-5 py-3 font-medium w-48">{row.label}</td>
                <td className="text-sm text-gray-200 px-5 py-3">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
