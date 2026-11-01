import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguageStore, Pagination, generatePassword } from 'common';
import { getUsers, createUser, updateUser, updateUserPassword, deleteUser, getBotStatuses } from '../lib/api';

interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  enabled: boolean;
  createdAt: number;
  lastLogin: number | null;
  lang: string;
  theme: string;
  exchangeName: string;
}

interface BotStatus {
  userId: number;
  mode: string;
  blocked: boolean;
  testnet: boolean;
}

export function Users() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState<User[]>([]);
  const [botStatuses, setBotStatuses] = useState<BotStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState({ username: '', password: '', email: '', role: 'regular' });
  const [showPassword, setShowPassword] = useState(false);
  const [editForm, setEditForm] = useState({ email: '', role: '', enabled: true, password: '' });
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [menuUserId, setMenuUserId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'regular' | 'demo'>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch = !search || u.username.toLowerCase().includes(search.toLowerCase()) || (u.email || '').toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  const botModeMap = useMemo(() => new Map(botStatuses.map((b) => [b.userId, b.mode])), [botStatuses]);
  const blockedMap = useMemo(() => new Map(botStatuses.map((b) => [b.userId, b.blocked])), [botStatuses]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  async function load() {
    setLoading(true);
    try {
      const [data, bots] = await Promise.all([getUsers(), getBotStatuses().catch(() => [])]);
      setUsers(data);
      setBotStatuses(bots);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const state = location.state as { editUserId?: number } | null;
    if (state?.editUserId && users.length > 0) {
      const user = users.find((u) => u.id === state.editUserId);
      if (user) openEdit(user);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [users, location.state]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createUser({ username: form.username, password: form.password, email: form.email || undefined, role: form.role });
      setShowCreate(false);
      setForm({ username: '', password: '', email: '', role: 'regular' });
      load();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }

  function openEdit(user: User) {
    setEditUser(user);
    setEditForm({ email: user.email || '', role: user.role, enabled: user.enabled, password: '' });
    setShowEditPassword(false);
    setEditError('');
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError('');
    try {
      await updateUser(editUser.id, { email: editForm.email || undefined, role: editForm.role, enabled: editForm.enabled });
      if (editForm.password) await updateUserPassword(editUser.id, editForm.password);
      setEditUser(null);
      load();
    } catch (err: any) {
      setEditError(err.response?.data?.error || err.message);
    }
  }

  async function handleToggle(user: User) {
    await updateUser(user.id, { enabled: !user.enabled });
    load();
  }

  async function handleDelete(user: User) {
    if (!confirm(t('confirmDeleteUser'))) return;
    await deleteUser(user.id);
    load();
  }

  function formatDate(ts: number | null) {
    if (!ts) return t('never');
    return new Date(ts).toLocaleString();
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-500/10 text-red-400 border-red-500/20',
      regular: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      demo: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    };
    return colors[role] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">{t('users')}</h2>
          <span className="text-xs text-gray-500 bg-gray-800 px-2.5 py-1 rounded-full">{filtered.length} / {users.length}</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {t('createUser')}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800/50">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder={`${t('username')} / ${t('email')}`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none flex-1 min-w-[200px]"
          />
          <div className="flex gap-1 text-xs">
            {(['all', 'admin', 'regular', 'demo'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setRoleFilter(f); setPage(0); }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${roleFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {f === 'all' ? t('all') : t(f)}
              </button>
            ))}
          </div>
          {(search || roleFilter !== 'all') && (
            <button onClick={() => { setSearch(''); setRoleFilter('all'); setPage(0); }} className="text-xs text-gray-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
              {t('clear')}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} autoComplete="off" className="bg-gray-900 rounded-xl p-5 space-y-4 border border-gray-800">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('username')}</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="off"
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('password')}</label>
              <div className="flex gap-2">
                <div className="relative w-full">
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="off"
                    className={`bg-gray-800 text-white rounded-lg px-3 py-2 pe-9 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none ${showPassword ? 'font-mono' : '[-webkit-text-security:disc]'}`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-3.12-3.12" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const pwd = generatePassword();
                    setForm({ ...form, password: pwd });
                    setShowPassword(true);
                    navigator.clipboard.writeText(pwd);
                  }}
                  title={t('generatePassword' as any)}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg px-2.5 py-2 text-sm transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('email')}</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('role')}</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="demo">{t('demo')}</option>
                <option value="regular">{t('regular')}</option>
                <option value="admin">{t('admin')}</option>
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
              {t('createUser')}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">{t('loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{users.length === 0 ? t('noUsers') : t('noTradesMatch')}</p>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-start px-4 py-3 font-medium">{t('username')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('email')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('role')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('enabled')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('createdAt')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('lastLogin')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('mode')}</th>
                <th className="text-end px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((user) => (
                <tr key={user.id} onClick={() => navigate(`/users/${user.id}`)} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium text-blue-400">
                    {user.username}
                    {blockedMap.get(user.id) && <span className="ms-1.5 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">{t('blocked' as any)}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{user.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${roleBadge(user.role)}`}>
                      {t(user.role as any)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(user); }}
                      className={`relative w-10 h-5 rounded-full transition-colors ${user.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                      dir="ltr"
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${user.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(user.lastLogin)}</td>
                  <td className="px-4 py-3 text-xs">
                    {botModeMap.get(user.id) === 'live' ? (
                      <span className="text-red-400 font-semibold uppercase">{t('live')}</span>
                    ) : (
                      <span className="text-blue-400 uppercase">{t('paper')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuUserId(menuUserId === user.id ? null : user.id); }}
                        className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                      </button>
                      {menuUserId === user.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuUserId(null); }} />
                          <div className="absolute end-0 bottom-8 z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[140px]">
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuUserId(null); openEdit(user); }}
                              className="w-full text-start px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              {t('edit')}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuUserId(null); handleDelete(user); }}
                              className="w-full text-start px-4 py-2 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors flex items-center gap-2"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              {t('remove')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditUser(null)}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-gray-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">{t('editUser')} — {editUser.username}</h3>
              <button onClick={() => setEditUser(null)} className="text-gray-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('email')}</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('role')}</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="demo">{t('demo')}</option>
                  <option value="regular">{t('regular')}</option>
                  <option value="admin">{t('admin')}</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400">{t('enabled')}</label>
                <button
                  type="button"
                  onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}
                  className={`relative w-12 h-6 rounded-full transition-colors ${editForm.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                  dir="ltr"
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${editForm.enabled ? 'left-[26px]' : 'left-0.5'}`} />
                </button>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('changePassword' as any)}</label>
                <div className="flex gap-2">
                  <div className="relative w-full">
                    <input
                      type="text"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      autoComplete="off"
                      placeholder={t('newPasswordPlaceholder' as any)}
                      className={`bg-gray-800 text-white rounded-lg px-3 py-2 pe-9 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none ${showEditPassword ? 'font-mono' : '[-webkit-text-security:disc]'}`}
                    />
                    {editForm.password && (
                      <button type="button" onClick={() => setShowEditPassword(!showEditPassword)} className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                        {showEditPassword ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-3.12-3.12" /></svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const pwd = generatePassword();
                      setEditForm({ ...editForm, password: pwd });
                      setShowEditPassword(true);
                      navigator.clipboard.writeText(pwd);
                    }}
                    title={t('generatePassword' as any)}
                    className="bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg px-2.5 py-2 text-sm transition-colors shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">{t('leaveEmptyToKeep' as any)}</p>
              </div>
              {editError && <p className="text-xs text-red-400">{editError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={!editUser || (editForm.email === (editUser.email || '') && editForm.role === editUser.role && editForm.enabled === editUser.enabled && !editForm.password)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600">
                  {t('save')}
                </button>
                <button type="button" onClick={() => setEditUser(null)} className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
