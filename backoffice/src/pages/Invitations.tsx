import { useEffect, useMemo, useState } from 'react';
import { useLanguageStore, Pagination } from 'common';
import { listInvitations, createInvitation, resendInvitation, revokeInvitation, type Invitation } from '../lib/api';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 10;

type StatusFilter = 'all' | 'pending' | 'expired' | 'accepted' | 'revoked';

export function Invitations() {
  const { t, formatDateTime } = useLanguageStore();
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [page, setPage] = useState(0);

  async function refresh() {
    setLoading(true);
    try {
      // Fetch everything once and filter client-side — the total invitation
      // count in an admin system is small enough that paginating server-side
      // would add complexity without meaningful benefit.
      const data = await listInvitations('all');
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter((i) => i.status === statusFilter);
  }, [items, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function setFilter(next: StatusFilter) {
    setStatusFilter(next);
    setPage(0);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (!EMAIL_REGEX.test(email)) { setError(t('invalidEmail')); return; }
    setError(null);
    setWarning(null);
    setSending(true);
    try {
      const result = await createInvitation(email);
      if (!result.emailSent) setWarning(t('emailNotConfiguredWarning'));
      setEmail('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('invitationSendFailed'));
    } finally {
      setSending(false);
    }
  }

  async function onResend(id: string) {
    try {
      const result = await resendInvitation(id);
      if (!result.emailSent) setWarning(t('emailNotConfiguredWarning'));
      else setWarning(null);
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || t('invitationSendFailed'));
    }
  }

  async function onRevoke(id: string) {
    if (!confirm(t('confirmRevokeInvitation'))) return;
    try {
      await revokeInvitation(id);
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || t('invitationRevokeFailed'));
    }
  }

  const STATUSES: StatusFilter[] = ['all', 'pending', 'expired', 'accepted', 'revoked'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('invitations')}</h2>
        <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">
          {filtered.length} {t('total')}
        </span>
      </div>

      <form onSubmit={send} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex gap-2">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={t('inviteEmailPlaceholder')} required disabled={sending}
          className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none disabled:opacity-60" />
        <button type="submit" disabled={sending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors inline-flex items-center gap-2">
          {sending && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {sending ? t('sending') : t('sendInvite')}
        </button>
      </form>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {warning && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm rounded-lg px-3 py-2">
          {warning}
        </div>
      )}

      {/* Status filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {t(s as any)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">{t('loading')}…</div>
        ) : paginated.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t('noInvitations')}</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-800">
                  <th className="text-start py-3 px-4">{t('email')}</th>
                  <th className="text-start py-3 px-4">{t('status')}</th>
                  <th className="text-start py-3 px-4">{t('sentAt')}</th>
                  <th className="text-start py-3 px-4">{t('expiresAt')}</th>
                  <th className="text-end py-3 px-4">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors">
                    <td className="py-3 px-4 font-medium">{inv.email}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={inv.status} t={t} />
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{formatDateTime(inv.createdAt)}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{formatDateTime(inv.expiresAt)}</td>
                    <td className="py-3 px-4 text-end space-x-2">
                      {(inv.status === 'pending' || inv.status === 'expired') && (
                        <button onClick={() => onResend(inv.id)} className="text-xs text-blue-400 hover:text-blue-300">{t('resend')}</button>
                      )}
                      {inv.status === 'pending' && (
                        <button onClick={() => onRevoke(inv.id)} className="text-xs text-red-400 hover:text-red-300">{t('revoke')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: Invitation['status']; t: (k: any) => string }) {
  const cls = status === 'pending' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    : status === 'accepted' ? 'bg-green-500/10 text-green-400 border-green-500/20'
    : status === 'expired' ? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    : 'bg-red-500/10 text-red-400 border-red-500/20';
  return <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border ${cls}`}>{t(status)}</span>;
}
