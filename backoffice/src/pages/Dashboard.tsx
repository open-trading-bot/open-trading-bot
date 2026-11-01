import { useEffect, useState } from 'react';
import { useLanguageStore } from 'common';
import { getStats, getUsers, getLeads, getBotStatuses } from '../lib/api';

interface Stats {
  totalTrades: number;
  openPositions: number;
  totalPnl: number;
}

export function Dashboard() {
  const { t } = useLanguageStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [activeBots, setActiveBots] = useState(0);
  const [leadCount, setLeadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getStats().catch(() => null),
      getBotStatuses().catch(() => []),
      getUsers().catch(() => []),
      getLeads().catch(() => []),
    ]).then(([s, bots, users, leads]) => {
      if (s) setStats(s);
      if (Array.isArray(bots)) setActiveBots(bots.filter((b: any) => b.status === 'running').length);
      if (Array.isArray(users)) setUserCount(users.length);
      if (Array.isArray(leads)) setLeadCount(leads.length);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  const cards = [
    { label: t('boTotalTrades'), value: stats?.totalTrades ?? 0, color: 'text-white' },
    { label: t('openPositions'), value: stats?.openPositions ?? 0, color: 'text-white' },
    { label: t('totalPnl'), value: `$${(stats?.totalPnl ?? 0).toFixed(2)}`, color: (stats?.totalPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: t('boTotalUsers'), value: userCount, color: 'text-white' },
    { label: t('boActiveBots'), value: activeBots, color: activeBots > 0 ? 'text-green-400' : 'text-gray-400' },
    { label: t('boTotalLeads'), value: leadCount, color: 'text-white' },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">{t('boDashboard')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-gray-900 rounded-xl border border-gray-800/50 p-5">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
