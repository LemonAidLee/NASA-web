// UI strings in English and Bahasa Melayu. The language is chosen once at load (link ?lang=ms|en, then the saved
// choice, then the browser language) and switching reloads the page, so every panel is rebuilt in the new language;
// the view itself is kept (state.ts saves it). A key missing in Malay falls back to English.
import en from './i18n/en.json';
import ms from './i18n/ms.json';

export type Lang = 'en' | 'ms';
export const LANGS: Lang[] = ['en', 'ms'];

function pick(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'ms') {
      localStorage.setItem('lang', q);
      return q;
    }
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'ms') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return /^(ms|id)\b/i.test(navigator.language ?? '') ? 'ms' : 'en';
}

export const lang: Lang = pick();
/** Locale for dates and numbers: "5 Dis 2024", "20,285". */
export const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';

const dict: Record<string, string> = lang === 'ms' ? { ...en, ...(ms as Record<string, string>) } : en;
document.documentElement.lang = lang;

/** Look up a UI string and fill {placeholders}. Missing keys show the key, so they are easy to spot. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = dict[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function has(key: string): boolean {
  return key in dict;
}

/** Switch language: remember it, drop ?lang from the address, and reload (the view is restored from storage). */
export function setLang(l: Lang): void {
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}
