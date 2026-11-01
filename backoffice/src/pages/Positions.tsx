import { useEffect, useMemo, useState } from 'react';
import { useLanguageStore, EmptyState, CryptoIcon, Pagination } from 'common';
import { getAllPositions, getUsers } from '../lib/api';

const PAGE_SIZE = 20;

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  amount: number;
  pnl: number;
  pnlPct: number;
  openedAt: number;
  userId: number;
  mode?: string;
  testnet: boolean;
  exchange?: string;
}

interface User {
  id: number;
  username: string;
}

type TestnetFilter = 'all' | 'true' | 'false';
type ExchangeFilter = 'all' | 'bybit' | 'binance';

export function Positions() {
  const { t, formatDateTime } = useLanguageStore();
  const [positions, setPositions] = useState<Position[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState<number | ''>('');
  const [testnetFilter, setTestnetFilter] = useState<TestnetFilter>('all');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    Promise.all([
      getAllPositions().catch(() => ({ data: [] })),
      getUsers().catch(() => []),
    ]).then(([p, u]: any) => {
      setPositions(p.data || p);
      setUsers(u);
    }).finally(() => setLoading(false));
  }, []);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.username])), [users]);

  const filtered = useMemo(() => {
    return positions.filter((p) => {
      if (userFilter !== '' && p.userId !== userFilter) return false;
      if (testnetFilter === 'true' && !p.testnet) return false;
      if (testnetFilter === 'false' && p.testnet) return false;
      if (exchangeFilter !== 'all' && p.exchange !== exchangeFilter) return false;
      return true;
    });
  }, [positions, userFilter, testnetFilter, exchangeFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{t('openPositions')}</h2>
          <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value === '' ? '' : Number(e.target.value)); setPage(0); }}
            className="bg-gray-800/50 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">{t('allUsers')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <select
            value={exchangeFilter}
            onChange={(e) => { setExchangeFilter(e.target.value as ExchangeFilter); setPage(0); }}
            className="bg-gray-800/50 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="all">{t('allExchanges')}</option>
            <option value="bybit">Bybit</option>
            <option value="binance">Binance</option>
          </select>
          <select
            value={testnetFilter}
            onChange={(e) => { setTestnetFilter(e.target.value as TestnetFilter); setPage(0); }}
            className="bg-gray-800/50 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="all">{t('allNetworks')}</option>
            <option value="false">{t('mainnet')}</option>
            <option value="true">{t('testnet')}</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="folder" message={t('noOpenPositions')} />
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800/50">
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('user')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('asset')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('side')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('entryPrice')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('currentPrice')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('amount')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end">{t('pnl')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('openedAt')}</th>
                  <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('network')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((pos) => (
                  <tr key={pos.id} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                    <td className="text-sm text-gray-300 px-4 py-3">{userMap.get(pos.userId) ?? (pos.userId === 0 ? '-' : `#${pos.userId}`)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <CryptoIcon symbol={pos.symbol} size={18} />
                        <span className="text-sm text-gray-200">{pos.symbol}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${pos.side === 'long' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.entryPrice.toFixed(2)}</td>
                    <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.currentPrice.toFixed(2)}</td>
                    <td className="text-sm text-gray-200 px-4 py-3 text-end">${pos.amount.toFixed(2)}</td>
                    <td className={`text-sm px-4 py-3 text-end ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${pos.pnl.toFixed(2)} ({pos.pnlPct.toFixed(1)}%)
                    </td>
                    <td className="text-sm text-gray-400 px-4 py-3 whitespace-nowrap">{formatDateTime(pos.openedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {pos.mode === 'live' && pos.exchange && (
                          <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {pos.exchange}
                          </span>
                        )}
                        {pos.mode === 'live' && pos.testnet && (
                          <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            {t('testnet')}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
