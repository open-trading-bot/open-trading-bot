import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore, languages, type Language } from 'common';
import { api } from '../lib/api';

declare global {
  interface Window { grecaptcha: any; }
}

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [interestEmail, setInterestEmail] = useState('');
  const [interestStatus, setInterestStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'captcha_error'>('idle');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const captchaWidgetId = useRef<number | null>(null);
  const { setToken } = useAuthStore();
  const { lang, setLang, t } = useLanguageStore();
  const navigate = useNavigate();

  // Load reCAPTCHA script with language — full reload on lang change
  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return;

    // Clean up previous
    document.querySelectorAll('script[src*="recaptcha"]').forEach((s) => s.remove());
    document.querySelectorAll('iframe[src*="recaptcha"]').forEach((f) => f.remove());
    document.querySelectorAll('.grecaptcha-badge').forEach((b) => b.remove());
    if (captchaRef.current) captchaRef.current.innerHTML = '';
    captchaWidgetId.current = null;
    setCaptchaToken(null);
    delete (window as any).grecaptcha;
    delete (window as any).___grecaptcha_cfg;

    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?hl=${lang}&render=explicit&_=${Date.now()}`;
    script.async = true;
    document.head.appendChild(script);

    const interval = setInterval(() => {
      if (window.grecaptcha?.render && captchaRef.current && captchaRef.current.childElementCount === 0) {
        captchaWidgetId.current = window.grecaptcha.render(captchaRef.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          theme: 'dark',
          size: 'normal',
          callback: (token: string) => setCaptchaToken(token),
          'expired-callback': () => setCaptchaToken(null),
        });
        clearInterval(interval);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [lang]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      setToken(data.token, data.role, data.username, data.email, !!data.disclaimerAccepted);
      if (!data.disclaimerAccepted) {
        navigate('/accept-disclaimer', { replace: true });
        return;
      }
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
    <div className="login-bg min-h-screen flex items-center justify-center px-4">
      {/* Language Switcher */}
      <div className="fixed top-4 end-4 z-50">
        <div className="flex bg-white/10 backdrop-blur-md rounded-full p-0.5 border border-white/10 shadow-lg">
          {Object.entries(languages).map(([code, { name }]) => (
            <button
              key={code}
              onClick={() => setLang(code as Language)}
              className={`relative px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-300 ${
                lang === code
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="crypto-symbols">
        {[
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
        ].map((c, i) => (
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
          <path fill="url(#g1)" d="M0,224L48,213.3C96,203,192,181,288,186.7C384,192,480,224,576,218.7C672,213,768,171,864,165.3C960,160,1056,192,1152,197.3C1248,203,1344,181,1392,170.7L1440,160L1440,320L0,320Z"/>
          <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#6366f1"/><stop offset="50%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#06b6d4"/></linearGradient></defs>
        </svg>
      </div>
      <div className="wave wave-2">
        <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g2)" d="M0,160L48,170.7C96,181,192,203,288,192C384,181,480,139,576,138.7C672,139,768,181,864,197.3C960,213,1056,203,1152,181.3C1248,160,1344,128,1392,112L1440,96L1440,320L0,320Z"/>
          <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#ec4899"/><stop offset="50%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#6366f1"/></linearGradient></defs>
        </svg>
      </div>
      <div className="wave wave-3">
        <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg">
          <path fill="url(#g3)" d="M0,256L48,261.3C96,267,192,277,288,261.3C384,245,480,203,576,197.3C672,192,768,224,864,234.7C960,245,1056,235,1152,213.3C1248,192,1344,160,1392,144L1440,128L1440,320L0,320Z"/>
          <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#22d3ee"/><stop offset="50%" stopColor="#6366f1"/><stop offset="100%" stopColor="#a855f7"/></linearGradient></defs>
        </svg>
      </div>
      <div className="relative z-10 bg-white/5 backdrop-blur-xl rounded-2xl p-10 w-full max-w-sm border border-white/10 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <span className="text-white text-xl font-bold">T</span>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-white mb-1">{t('loginTitle')}</h1>
        <p className="text-sm text-gray-400 text-center mb-8">{t('loginSubtitle')}</p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('usernameOrEmail')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-600"
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

        <div className="mt-6 pt-6 border-t border-white/10">
          <p className="text-xs text-gray-400 text-center mb-3">{t('interestedTitle')}</p>
          {interestStatus === 'sent' ? (
            <p className="text-xs text-green-400 text-center">{t('interestedSuccess')}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder={t('interestedPlaceholder')}
                  value={interestEmail}
                  onChange={(e) => { setInterestEmail(e.target.value); if (interestStatus === 'error' || interestStatus === 'captcha_error') setInterestStatus('idle'); }}
                  className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder-gray-400"
                />
                <button
                  onClick={async () => {
                    setInterestStatus('sending');
                    try {
                      await api.post('/auth/interest', { email: interestEmail, captchaToken });
                      setInterestStatus('sent');
                      setInterestEmail('');
                      setCaptchaToken(null);
                    } catch (err: any) {
                      const serverError = err.response?.data?.error || '';
                      setInterestStatus(serverError.includes('Captcha') ? 'captcha_error' : 'error');
                      if (captchaWidgetId.current !== null) window.grecaptcha?.reset(captchaWidgetId.current);
                      setCaptchaToken(null);
                    }
                  }}
                  disabled={interestStatus === 'sending' || !interestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(interestEmail) || (!!RECAPTCHA_SITE_KEY && !captchaToken)}
                  className="bg-white/10 hover:bg-white/15 text-white text-xs px-4 py-2 rounded-lg font-medium border border-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {interestStatus === 'sending' ? t('interestedSending') : t('interestedSubmit')}
                </button>
              </div>
              {RECAPTCHA_SITE_KEY && (
                <div className="flex justify-center" ref={captchaRef} />
              )}
            </div>
          )}
          {(interestStatus === 'error' || interestStatus === 'captcha_error') && (
            <p className="text-xs text-red-400 mt-2 text-center">{t(interestStatus === 'captcha_error' ? 'interestedCaptchaError' : 'interestedError')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
