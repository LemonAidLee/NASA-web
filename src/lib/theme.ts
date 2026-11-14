import type { Theme } from '../state';

/** Read a UI token from CSS (plan 14 §9: UI colours only through CSS variables). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** OpenFreeMap styles (plan 14 §8.1): dark for Tokyo Night and Situation Room, positron for Flexoki Light. */
export function basemapStyle(theme: Theme): string {
  if (theme === 'flexoki-light') return 'https://tiles.openfreemap.org/styles/positron';
  // Same dark style, but its own URL key, so switching to or from Deep Space reloads the style and the navy re-tint is applied
  // or cleared (the fragment is not sent to the server).
  if (theme === 'deep-space') return 'https://tiles.openfreemap.org/styles/dark#deep-space';
  return 'https://tiles.openfreemap.org/styles/dark';
}
