import { useEffect, useState } from 'react';
import { useLanguageStore, EmptyState } from 'common';
import { getBotStatuses, getUsers } from '../lib/api';

interface BotStatus {
  userId: number;
  username: string;
  status: string;
  mode: string;
}

interface User {
  id: number;
  username: string;
  role: string;
}

export function BotControl() {
  const { t } = useLanguageStore();
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getBotStatuses().catch(() => []),
      getUsers().catch(() => []),
    ]).then(([b, u]) => {
      setBots(b);
      setUsers(u);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">{t('boBotControl')}</h2>

      {bots.length === 0 ? (
        <EmptyState icon="folder" message={t('noUsers')} />
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800/50">
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('username')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('role')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('boBotStatus')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('boBotMode')}</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((bot) => {
                  const user = userMap.get(bot.userId);
                  const isRunning = bot.status === 'running';
                  return (
                    <tr key={bot.userId} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                      <td className="text-sm text-gray-200 px-4 py-3">{bot.username}</td>
                      <td className="text-sm text-gray-400 px-4 py-3">{user ? t(user.role as any) || user.role : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${isRunning ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>
                          {t(bot.status as any)}
                        </span>
                      </td>
                      <td className="text-sm text-blue-400 px-4 py-3">{bot.mode.toUpperCase()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
