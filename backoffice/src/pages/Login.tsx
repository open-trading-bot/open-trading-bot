import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore, languages, type Language } from 'common';
import { api } from '../lib/api';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setToken } = useAuthStore();
  const { lang, setLang, t } = useLanguageStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      if (data.role !== 'admin') {
        setError(t('adminAccessRequired'));
        setLoading(false);
        return;
      }
      setToken(data.token, data.role, data.username, data.email);
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err.response?.status === 429) {
        const retry = err.response.data.retryAfter;
        setError(t('tooManyAttempts', { minutes: Math.ceil(retry / 60) }));
      } else {
        const remaining = err.response?.data?.attemptsRemaining;
        setError(remaining !== undefined
          ? t('attemptsRemaining', { count: remaining })
          : t('invalidCredentials'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      {/* Language Switcher */}
      <div className="fixed top-4 end-4 z-50">
        <div className="flex bg-gray-800/50 rounded-lg p-0.5">
          {Object.entries(languages).map(([code, { name }]) => (
            <button
              key={code}
              onClick={() => setLang(code as Language)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                lang === code ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl p-8 w-full max-w-sm border border-gray-800/50 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <span className="text-white text-xl font-bold">B</span>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-white mb-1">{t('boTitle')}</h1>
        <p className="text-sm text-gray-400 text-center mb-8">{t('loginSubtitle')}</p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-gray-800/50 border border-gray-700 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-gray-800/50 border border-gray-700 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
          >
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
