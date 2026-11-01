import { create } from 'zustand';
import { languages, type Language, type TranslationKey } from '../i18n';

interface LanguageStore {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatTime: (date: Date | number) => string;
  formatDateTime: (date: Date | number) => string;
  formatRelativeTime: (date: Date | number) => string;
}

const stored = localStorage.getItem('lang') as Language | null;
const initialLang = stored && stored in languages ? stored : 'en';
document.documentElement.dir = languages[initialLang].dir;

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  lang: initialLang,
  setLang: (lang) => {
    localStorage.setItem('lang', lang);
    document.documentElement.dir = languages[lang].dir;
    set({ lang });
  },
  t: (key, params) => {
    const { lang } = get();
    let text: string = languages[lang].translations[key] ?? languages.en.translations[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  },
  formatTime: (date) => {
    const { lang } = get();
    return new Date(date).toLocaleTimeString(languages[lang].locale);
  },
  formatDateTime: (date) => {
    const { lang } = get();
    return new Date(date).toLocaleString(languages[lang].locale);
  },
  formatRelativeTime: (date) => {
    const { lang } = get();
    const t = (key: TranslationKey) => languages[lang].translations[key] ?? languages.en.translations[key] ?? key;
    const now = Date.now();
    const ts = typeof date === 'number' ? date : date.getTime();
    const diffMs = now - ts;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return t('justNow');
    if (diffMin < 60) return `${diffMin}${t('minutesShort')} ${t('ago')}`;
    if (diffHr < 24) return `${diffHr}${t('hoursShort')} ${t('ago')}`;
    if (diffDays < 7) return `${diffDays}${t('daysShort')} ${t('ago')}`;
    return new Date(ts).toLocaleString(languages[lang].locale);
  },
}));
