import en from './i18n/en.json';

const dict: Record<string, string> = en;

/** Look up a UI string and fill {placeholders}. Missing keys show the key, so they are easy to spot. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = dict[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function has(key: string): boolean {
  return key in dict;
}
