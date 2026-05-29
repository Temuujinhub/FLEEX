import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import mn from './locales/mn.json';
import en from './locales/en.json';

// Language persistence key. The app launches in Mongolian (the operational
// language) and falls back to it for any missing key; English is opt-in via
// the in-app switcher.
export const LANG_KEY = 'fleex.lang';
export const SUPPORTED_LANGS = ['mn', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const stored =
  typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
const initial: Lang = stored === 'en' || stored === 'mn' ? stored : 'mn';

void i18n.use(initReactI18next).init({
  resources: {
    mn: { translation: mn },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'mn',
  interpolation: { escapeValue: false }, // React already escapes
});

// Keep <html lang> + localStorage in sync with the active language.
if (typeof document !== 'undefined') {
  document.documentElement.lang = initial;
}
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
  if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lng);
});

export default i18n;
