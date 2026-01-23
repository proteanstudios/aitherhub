import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ja from './locales/ja.json';
import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: 'ja',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// convenience: export bound `t` and expose a global helper for quick usage
export const t = i18n.t.bind(i18n);
try {
  // attach to window for components that prefer calling without imports
  if (typeof window !== 'undefined') window.__t = t;
} catch (e) {}

export default i18n;
