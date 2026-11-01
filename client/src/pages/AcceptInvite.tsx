import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore, useLanguageStore, checkPassword, isPasswordValid } from 'common';
import { lookupInvitation, acceptInvitation } from '../lib/api';
import { DisclaimerGate } from '../components/DisclaimerGate';

const CRYPTO_SYMBOLS = [
  { symbol: '₿', top: '8%', left: '10%', duration: '8s', delay: '0s' },
  { symbol: 'Ξ', top: '15%', left: '75%', duration: '10s', delay: '1s' },
  { symbol: '◎', top: '70%', left: '15%', duration: '9s', delay: '2s' },
  { symbol: '₿', top: '60%', left: '85%', duration: '11s', delay: '0.5s' },
  { symbol: 'Ξ', top: '35%', left: '5%', duration: '12s', delay: '3s' },
  { symbol: '◎', top: '25%', left: '90%', duration: '7s', delay: '1.5s' },
  { symbol: '₮', top: '80%', left: '50%', duration: '10s', delay: '2.5s' },
  { symbol: '₿', top: '45%', left: '65%', duration: '9s', delay: '4s' },
  { symbol: 'Ξ', top: '55%', left: '30%', duration: '13s', delay: '0.8s' },
  { symbol: '◎', top: '12%', left: '45%', duration: '11s', delay: '3.5s' },
  { symbol: '₮', top: '40%', left: '20%', duration: '8s', delay: '1.2s' },
  { symbol: '₿', top: '75%', left: '70%', duration: '10s', delay: '2.8s' },
];

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-bg min-h-screen flex items-center justify-center px-4">
      <div className="crypto-symbols">
        {CRYPTO_SYMBOLS.map((c, i) => (
          <span
            key={i}
            className="crypto-symbol"
            style={{ top: c.top, left: c.left, '--duration': c.duration, '--delay': c.delay } as React.CSSProperties}
          >
            {c.symbol}
          </span>
        ))}
      </div>
      <div className="mesh-layer mesh-1" />
      <div className="mesh-layer mesh-2" />
      <div className="mesh-layer mesh-3" />
      <div className="mesh-layer mesh-4" />
      <div className="mesh-layer mesh-5" />
      <div className="wave wave-1">
        <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g1)" d="M0,224L48,213.3C96,203,192,181,288,186.7C384,192,480,224,576,218.7C672,213,768,171,864,165.3C960,160,1056,192,1152,197.3C1248,203,1344,181,1392,170.7L1440,160L1440,320L0,320Z" />
          <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#6366f1" /><stop offset="50%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#06b6d4" /></linearGradient></defs>
        </svg>
      </div>
      <div className="wave wave-2">
        <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g2)" d="M0,160L48,170.7C96,181,192,203,288,192C384,181,480,139,576,138.7C672,139,768,181,864,197.3C960,213,1056,203,1152,181.3C1248,160,1344,128,1392,112L1440,96L1440,320L0,320Z" />
          <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#ec4899" /><stop offset="50%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#6366f1" /></linearGradient></defs>
        </svg>
      </div>
      <div className="wave wave-3">
        <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g3)" d="M0,256L48,261.3C96,267,192,277,288,261.3C384,245,480,203,576,197.3C672,192,768,224,864,234.7C960,245,1056,235,1152,213.3C1248,192,1344,160,1392,144L1440,128L1440,320L0,320Z" />
          <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#22d3ee" /><stop offset="50%" stopColor="#6366f1" /><stop offset="100%" stopColor="#a855f7" /></linearGradient></defs>
        </svg>
      </div>
      {children}
    </div>
  );
}

export function AcceptInvite() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { setToken } = useAuthStore();

  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [email, setEmail] = useState<string>('');
  const [step, setStep] = useState<1 | 2>(1);
  const [signature, setSignature] = useState<string>('');
  const [lang, setLang] = useState<'en' | 'he'>('en');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pwCheck = useMemo(() => checkPassword(password), [password]);
  const pwValid = useMemo(() => isPasswordValid(password), [password]);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    lookupInvitation(token)
      .then((res) => { setEmail(res.email); setStatus('valid'); })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    if (!pwValid) { setError(t('passwordTooShort')); return; }
    if (password !== confirm) { setError(t('passwordMismatch')); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await acceptInvitation(token, password, signature, lang);
      setToken(res.token, res.role, res.username, null, res.disclaimerAccepted);
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.error || t('invitationInvalid'));
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return (
      <PageShell>
        <div className="relative z-10 text-gray-300">{t('loading')}…</div>
      </PageShell>
    );
  }

  if (status === 'invalid') {
    return (
      <PageShell>
        <div className="relative z-10 bg-white/5 backdrop-blur-xl rounded-2xl p-10 w-full max-w-sm border border-white/10 shadow-2xl text-center">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">{t('invitationInvalidTitle')}</h2>
          <p className="text-sm text-gray-400 mb-5">{t('invitationInvalidBody')}</p>
          <a href="/login" className="inline-block text-blue-400 text-sm hover:text-blue-300 hover:underline">{t('goToLogin')}</a>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="relative z-10 bg-white/5 backdrop-blur-xl rounded-2xl p-10 w-full max-w-xl border border-white/10 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <span className="text-white text-xl font-bold">T</span>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-white mb-1">{t('acceptInviteTitle')}</h1>
        <p className="text-sm text-gray-400 text-center mb-6">
          {t('acceptInviteIntro')} <span className="font-medium text-white">{email}</span>
        </p>

        {step === 1 ? (
          <DisclaimerGate
            onSigned={({ signature: sig, lang: l }) => {
              setSignature(sig);
              setLang(l);
              setStep(2);
            }}
          />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs text-gray-400 hover:text-gray-200 underline"
            >
              {t('disclaimerBack')}
            </button>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white/5 border border-white/10 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
                autoFocus
              />
              {password.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {([
                    ['minLength', t('pwRuleMinLength')],
                    ['hasUppercase', t('pwRuleUppercase')],
                    ['hasDigit', t('pwRuleDigit')],
                    ['hasSymbol', t('pwRuleSymbol')],
                  ] as const).map(([key, label]) => (
                    <li key={key} className={`text-[11px] flex items-center gap-1.5 ${pwCheck[key] ? 'text-green-400' : 'text-gray-500'}`}>
                      {pwCheck[key] ? '✓' : '○'} {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('confirmPassword')}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="bg-white/5 border border-white/10 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={busy || !pwValid || password !== confirm}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-all shadow-lg inline-flex items-center justify-center gap-2"
            >
              {busy && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {busy ? t('creatingAccount') : t('createAccountAndLogin')}
            </button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
