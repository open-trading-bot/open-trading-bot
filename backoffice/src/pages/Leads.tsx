import { useEffect, useMemo, useState } from 'react';
import { useLanguageStore, EmptyState, Pagination } from 'common';
import { getLeads, getUsers, deleteLead } from '../lib/api';

interface Lead {
  id: number;
  email: string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export function Leads() {
  const { t, formatDateTime } = useLanguageStore();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [userEmails, setUserEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'registered' | 'lead'>('all');
  const [page, setPage] = useState(0);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const PAGE_SIZE = 10;

  async function load() {
    const [leadsData, usersData] = await Promise.all([
      getLeads().catch(() => []),
      getUsers().catch(() => []),
    ]);
    setLeads(leadsData);
    setUserEmails(new Set(usersData.filter((u: any) => u.email).map((u: any) => u.email.toLowerCase())));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(lead: Lead) {
    if (!confirm(t('boConfirmDeleteLead'))) return;
    await deleteLead(lead.id);
    load();
  }

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch = !search || lead.email.toLowerCase().includes(search.toLowerCase());
      const isUser = userEmails.has(lead.email.toLowerCase());
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'registered' && isUser) || (statusFilter === 'lead' && !isUser);
      return matchesSearch && matchesStatus;
    });
  }, [leads, search, statusFilter, userEmails]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (loading) {
    return <p className="text-gray-500 text-sm">{t('loading')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{t('boLeads')}</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{filtered.length} / {leads.length}</span>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder={t('boEmail')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none flex-1 min-w-[200px]"
          />
          <div className="flex gap-1 text-xs">
            {(['all', 'registered', 'lead'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setStatusFilter(f); setPage(0); }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${statusFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {f === 'all' ? t('all') : f === 'registered' ? t('boRegistered') : t('boLeadOnly')}
              </button>
            ))}
          </div>
          {(search || statusFilter !== 'all') && (
            <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
              {t('clear')}
            </button>
          )}
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState icon="folder" message={t('boNoLeads')} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="folder" message={t('noTradesMatch')} />
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800/50">
                <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('boEmail')}</th>
                <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('boDate')}</th>
                <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-start">{t('boStatus')}</th>
                <th className="text-[11px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 text-end"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((lead, i) => {
                const isUser = userEmails.has(lead.email.toLowerCase());
                return (
                  <tr key={i} onClick={() => setSelectedLead(lead)} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors cursor-pointer">
                    <td className="text-sm text-gray-200 px-4 py-3">{lead.email}</td>
                    <td className="text-sm text-gray-400 px-4 py-3">{formatDateTime(Number(lead.createdAt))}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${isUser ? 'bg-green-500/10 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        {isUser ? t('boRegistered') : t('boLeadOnly')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {!isUser && (
                        <button
                          onClick={() => handleDelete(lead)}
                          className="text-gray-600 hover:text-red-400 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Lead Detail Modal */}
      {selectedLead && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedLead(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">{t('boLeadOnly')}</h3>
              <button onClick={() => setSelectedLead(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-2.5">
              <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('email')}</div>
                <div className="text-sm font-mono">{selectedLead.email}</div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('boDate')}</div>
                  <div className="text-sm font-mono">{formatDateTime(Number(selectedLead.createdAt))}</div>
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('boStatus')}</div>
                  <div className="text-sm">
                    <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-md ${userEmails.has(selectedLead.email.toLowerCase()) ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                      {userEmails.has(selectedLead.email.toLowerCase()) ? t('boRegistered') : t('boLeadOnly')}
                    </span>
                  </div>
                </div>
              </div>
              {selectedLead.ip && (
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('ipAddress' as any)}</div>
                  <div className="text-sm font-mono">{selectedLead.ip}</div>
                </div>
              )}
              {selectedLead.referrer && (
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('referrer' as any)}</div>
                  <div className="text-sm font-mono break-all">{selectedLead.referrer}</div>
                </div>
              )}
              {selectedLead.userAgent && (
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-800/50">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('userAgent' as any)}</div>
                  <div className="text-xs text-gray-400 break-all">{selectedLead.userAgent}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
