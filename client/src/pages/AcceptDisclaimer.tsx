import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore } from 'common';
import { DisclaimerGate } from '../components/DisclaimerGate';
import { acceptDisclaimer } from '../lib/api';

export function AcceptDisclaimer() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const { logout, setDisclaimerAccepted } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSigned({ signature, lang }: { signature: string; lang: 'en' | 'he' }) {
    setSubmitting(true);
    setError(null);
    try {
      await acceptDisclaimer(signature, lang);
      setDisclaimerAccepted(true);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || t('disclaimerError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-10 w-full max-w-xl border border-white/10 shadow-2xl">
        <DisclaimerGate onSigned={handleSigned} submitting={submitting} submitError={error} />
        <button
          type="button"
          onClick={() => { logout(); navigate('/login'); }}
          className="mt-6 text-xs text-gray-400 hover:text-gray-200 underline"
        >
          {t('disclaimerLogout')}
        </button>
      </div>
    </div>
  );
}
