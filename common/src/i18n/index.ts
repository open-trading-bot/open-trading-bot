import en from './en';
import he from './he';

export const languages = {
  en: { name: 'English', dir: 'ltr', locale: 'en-GB', translations: en },
  he: { name: 'עברית', dir: 'rtl', locale: 'he-IL', translations: he },
} as const;

export type Language = keyof typeof languages;
export type TranslationKey = keyof typeof en;
