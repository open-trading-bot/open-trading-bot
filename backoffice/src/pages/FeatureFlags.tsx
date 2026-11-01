import { useEffect, useState } from 'react';
import { getFeatureFlags, createFeatureFlag, updateFeatureFlag, deleteFeatureFlag, setFeatureFlagOverrides, getUsers } from '../lib/api';
import { useLanguageStore } from 'common';

interface Override {
  targetType: 'user' | 'role';
  targetValue: string;
  enabled: boolean;
}

interface Flag {
  id: string;
  description: string;
  enabled: boolean;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
  overrides: Override[];
}

interface User {
  id: number;
  username: string;
  role: string;
}

const ROLES = ['admin', 'regular', 'demo'];

export function FeatureFlags() {
  const { t } = useLanguageStore();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEnabled, setNewEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    getUsers().then(setUsers).catch(() => {});
  }, []);

  async function load() {
    const data = await getFeatureFlags();
    setFlags(data);
  }

  async function handleCreate() {
    if (!newId || !newDesc) return;
    setSaving(true);
    setError(null);
    try {
      await createFeatureFlag({ id: newId, description: newDesc, enabled: newEnabled });
      setNewId('');
      setNewDesc('');
      setNewEnabled(false);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
    setSaving(false);
  }

  async function handleToggle(flag: Flag) {
    await updateFeatureFlag(flag.id, { enabled: !flag.enabled });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete flag "${id}"?`)) return;
    await deleteFeatureFlag(id);
    setExpandedFlag(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('featureFlags') || 'Feature Flags'}</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-sm px-4 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          {showCreate ? (t('cancel') || 'Cancel') : (t('createFlag') || 'Create Flag')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-sm ms-2">x</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800/50">
          <h3 className="text-sm font-medium text-gray-400">{t('newFlag') || 'New Flag'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('flagId') || 'Flag ID'}</label>
              <input
                type="text"
                placeholder="e.g. myFeature"
                value={newId}
                onChange={(e) => setNewId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('description')}</label>
              <input
                type="text"
                placeholder={t('flagDescPlaceholder')}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{t('enabledByDefault') || 'Enabled by default'}</span>
              <button
                onClick={() => setNewEnabled(!newEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${newEnabled ? 'bg-green-600' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${newEnabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
              </button>
            </div>
            <button
              onClick={handleCreate}
              disabled={!newId || !newDesc || saving}
              className="text-sm px-4 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (t('saving') || 'Saving...') : (t('create') || 'Create')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {flags.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">{t('noFeatureFlags') || 'No feature flags yet'}</div>
        )}
        {flags.map((flag) => (
          <div key={flag.id} className="bg-gray-900 rounded-xl border border-gray-800/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  onClick={() => setExpandedFlag(expandedFlag === flag.id ? null : flag.id)}
                  className="text-gray-500 hover:text-white transition-colors shrink-0"
                >
                  <svg className={`w-4 h-4 transition-transform ${expandedFlag === flag.id ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium">{flag.id}</span>
                    {flag.overrides.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {flag.overrides.length} {flag.overrides.length === 1 ? t('override') : t('overrides')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {flag.description}
                    <span className="text-gray-600 ms-2">
                      · {t('createdBy') || 'Created by'} {users.find((u) => u.id === flag.createdBy)?.username || (flag.createdBy === 0 ? 'System' : `#${flag.createdBy}`)}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(flag)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${flag.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${flag.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            {expandedFlag === flag.id && (
              <OverrideEditor flag={flag} users={users} onSave={load} onDelete={() => handleDelete(flag.id)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverrideEditor({ flag, users, onSave, onDelete }: { flag: Flag; users: User[]; onSave: () => Promise<void>; onDelete: () => void }) {
  const { t } = useLanguageStore();
  const [overrides, setOverrides] = useState<Override[]>(flag.overrides);
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const hasChanges = JSON.stringify(overrides) !== JSON.stringify(flag.overrides);

  function getRoleState(role: string): 'inherit' | 'enabled' | 'disabled' {
    const o = overrides.find((ov) => ov.targetType === 'role' && ov.targetValue === role);
    if (!o) return 'inherit';
    return o.enabled ? 'enabled' : 'disabled';
  }

  function cycleRole(role: string) {
    const current = getRoleState(role);
    const next = current === 'inherit' ? 'enabled' : current === 'enabled' ? 'disabled' : 'inherit';
    const without = overrides.filter((o) => !(o.targetType === 'role' && o.targetValue === role));
    if (next === 'inherit') {
      setOverrides(without);
    } else {
      setOverrides([...without, { targetType: 'role', targetValue: role, enabled: next === 'enabled' }]);
    }
  }

  function toggleUserOverride(userId: string) {
    setOverrides(overrides.map((o) =>
      o.targetType === 'user' && o.targetValue === userId ? { ...o, enabled: !o.enabled } : o
    ));
  }

  function addUserOverride(userId: string) {
    if (overrides.some((o) => o.targetType === 'user' && o.targetValue === userId)) return;
    setOverrides([...overrides, { targetType: 'user', targetValue: userId, enabled: true }]);
  }

  function removeUserOverride(userId: string) {
    setOverrides(overrides.filter((o) => !(o.targetType === 'user' && o.targetValue === userId)));
  }

  async function handleSave() {
    setSaving(true);
    await setFeatureFlagOverrides(flag.id, overrides);
    await onSave();
    setSaving(false);
  }

  const userOverrides = overrides.filter((o) => o.targetType === 'user');
  const overrideUserIds = new Set(userOverrides.map((o) => o.targetValue));
  const availableUsers = users.filter((u) => !overrideUserIds.has(String(u.id)) && (
    !userSearch || u.username.toLowerCase().includes(userSearch.toLowerCase())
  ));

  return (
    <div className="border-t border-gray-800/50 px-5 py-4 space-y-4 bg-gray-900/50">
      <div>
        <h4 className="text-xs font-medium text-gray-400 mb-2">{t('roleOverrides') || 'Role Overrides'}</h4>
        <div className="flex gap-2">
          {ROLES.map((role) => {
            const state = getRoleState(role);
            return (
              <button
                key={role}
                onClick={() => cycleRole(role)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                  state === 'enabled'
                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                    : state === 'disabled'
                      ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : 'bg-gray-800 border-gray-700 text-gray-500'
                }`}
              >
                {t(role as any)}: {t(state as any)}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-600 mt-1">{t('clickToCycle') || 'Click to cycle: inherit → enabled → disabled'}</p>
      </div>

      <div>
        <h4 className="text-xs font-medium text-gray-400 mb-2">{t('userOverrides') || 'User Overrides'}</h4>
        {userOverrides.length > 0 && (
          <div className="space-y-1 mb-2">
            {userOverrides.map((o) => {
              const user = users.find((u) => String(u.id) === o.targetValue);
              return (
                <div key={o.targetValue} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{user?.username || `User #${o.targetValue}`}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${user?.role === 'admin' ? 'bg-purple-500/10 text-purple-400' : user?.role === 'regular' ? 'bg-blue-500/10 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>
                      {user?.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleUserOverride(o.targetValue)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${o.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${o.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                    </button>
                    <button
                      onClick={() => removeUserOverride(o.targetValue)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative">
          <input
            type="text"
            placeholder={t('searchUsers') || 'Search users to add override...'}
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm w-full border border-gray-700 focus:border-blue-500 focus:outline-none"
          />
          {userSearch && availableUsers.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden max-h-40 overflow-y-auto">
              {availableUsers.slice(0, 8).map((u) => (
                <button
                  key={u.id}
                  onClick={() => { addUserOverride(String(u.id)); setUserSearch(''); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-start hover:bg-gray-800 transition-colors"
                >
                  <span>{u.username}</span>
                  <span className="text-[10px] text-gray-500">{u.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-800/50">
        <button
          onClick={onDelete}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          {t('deleteFlag') || 'Delete flag'}
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`text-sm px-4 py-2 rounded-lg font-medium transition-all ${hasChanges ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
        >
          {saving ? (t('saving') || 'Saving...') : (t('saveOverrides') || 'Save Overrides')}
        </button>
      </div>
    </div>
  );
}
