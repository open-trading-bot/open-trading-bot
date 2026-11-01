import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguageStore } from 'common';
import { getDisclaimer, type DisclaimerPayload } from '../lib/api';

type Lang = 'en' | 'he';

interface Props {
  onSigned: (payload: { signature: string; lang: Lang }) => void | Promise<void>;
  submitting?: boolean;
  submitError?: string | null;
}

function renderDisclaimerText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((segment, i) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={i} className="text-white font-semibold">{segment.slice(2, -2)}</strong>;
    }
    return <span key={i}>{segment}</span>;
  });
}

export function DisclaimerGate({ onSigned, submitting = false, submitError = null }: Props) {
  const { lang, t } = useLanguageStore();
  const currentLang: Lang = lang === 'he' ? 'he' : 'en';

  const [payload, setPayload] = useState<DisclaimerPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checked, setChecked] = useState(false);
  const [signature, setSignature] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getDisclaimer()
      .then(setPayload)
      .catch(() => setLoadError(t('disclaimerError')));
  }, [t]);

  // Reset gate state whenever the user switches language — they must re-read
  // and re-sign in the new language to prevent accidental one-click accept.
  useEffect(() => {
    setScrolledToBottom(false);
    setChecked(false);
    setSignature('');
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentLang]);

  const variant = payload?.variants[currentLang];
  const requiredPhrase = variant?.requiredSignature ?? '';

  const signatureValid = useMemo(() => {
    if (!requiredPhrase) return false;
    return signature.trim().toLowerCase() === requiredPhrase.trim().toLowerCase();
  }, [signature, requiredPhrase]);

  const canContinue = scrolledToBottom && checked && signatureValid && !submitting;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    // 8px tolerance — some browsers round scrollHeight/clientHeight so
    // reaching the exact bottom is not pixel-precise.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      setScrolledToBottom(true);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canContinue) return;
    onSigned({ signature: signature.trim(), lang: currentLang });
  }

  if (loadError) {
    return <p className="text-red-400 text-sm">{loadError}</p>;
  }
  if (!variant) {
    return <p className="text-gray-400 text-sm">{t('loading')}…</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h2 className="text-lg font-semibold text-white">{t('disclaimerTitle')}</h2>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-80 overflow-y-auto whitespace-pre-wrap bg-white/10 border border-white/15 rounded-lg p-5 text-[0.95rem] text-gray-100 leading-7"
      >
        {renderDisclaimerText(variant.text)}
      </div>

      {!scrolledToBottom && (
        <p className="text-xs text-gray-500">{t('disclaimerScrollHint')}</p>
      )}

      <label className={`flex items-start gap-2 text-sm ${scrolledToBottom ? 'text-gray-200' : 'text-gray-500 cursor-not-allowed'}`}>
        <input
          type="checkbox"
          disabled={!scrolledToBottom}
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
        />
        <span>{t('disclaimerReadCheckbox')}</span>
      </label>

      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {t('disclaimerSignatureLabel')}{' '}
          <span className="font-semibold text-white">{requiredPhrase}</span>
        </label>
        <input
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={t('disclaimerSignaturePlaceholder', { phrase: requiredPhrase })}
          disabled={!checked}
          className="bg-white/5 border border-white/10 text-white rounded-lg px-3.5 py-2.5 text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

      <button
        type="submit"
        disabled={!canContinue}
        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition-all shadow-lg"
      >
        {submitting ? t('disclaimerSubmitting') : t('disclaimerContinue')}
      </button>
    </form>
  );
}
