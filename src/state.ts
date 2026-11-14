// One source of truth (plan 06 §6.4 rule 1). UI writes state; map modules subscribe. URL sync is F11.
import { area, cfg, layersFor } from './config';
import { storage } from './lib/dom';

export type Mode = 'simple' | 'expert';
export type CompareMode = 'off' | 'dates' | 'pol';
export type Base = 'map' | 'sat';
export type Theme = 'deep-space' | 'tokyo-night' | 'situation-room' | 'flexoki-light';
export type Sheet = 'peek' | 'half' | 'full';

export interface LayerState {
  on: boolean;
  opacity: number;
}

export interface State {
  area: string;
  date: string;
  layers: Record<string, LayerState>;
  compare: CompareMode;
  cmpA: string;
  cmpB: string;
  base: Base;
  theme: Theme;
  mode: Mode;
  step: number | null;
  tab: string;
  sheet: Sheet;
  playing: boolean;
  district: string | null;
  sureOpen: boolean;
  dockOpen: boolean;
  /** Selected focus area (focus_areas.json id) and the AI-analysis dashboard state. */
  focus: string | null;
  dash: 'closed' | 'open' | 'max';
}

type Listener = (s: State, changed: Set<keyof State>) => void;

export const THEMES: Theme[] = ['deep-space', 'tokyo-night', 'situation-room', 'flexoki-light'];

let state: State;
const listeners: Listener[] = [];

export function get(): State {
  return state;
}

export function subscribe(fn: Listener): void {
  listeners.push(fn);
}

export function set(patch: Partial<State>): void {
  const changed = new Set<keyof State>();
  for (const k of Object.keys(patch) as (keyof State)[]) {
    if (JSON.stringify(state[k]) !== JSON.stringify(patch[k])) changed.add(k);
  }
  if (!changed.size) return;
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state, changed);
  scheduleUrl();
}

export function setLayer(id: string, patch: Partial<LayerState>): void {
  const layers = { ...state.layers, [id]: { ...state.layers[id], ...patch } };
  // Radio pairs (plan 07 F2): turning one on turns its partners off.
  if (patch.on) {
    const def = cfg.layers.find((l) => l.id === id);
    for (const other of def?.exclusive_with ?? []) layers[other] = { ...layers[other], on: false };
  }
  set({ layers });
}

function defaultLayers(): Record<string, LayerState> {
  const out: Record<string, LayerState> = {};
  for (const l of cfg.layers) out[l.id] = { on: l.on, opacity: l.opacity };
  return out;
}

// ---------- URL (F11) ----------

let urlTimer = 0;
function scheduleUrl(): void {
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(writeUrl, 250);
}

// ---------- saved view (localStorage) ----------
// The URL carries a shareable view (area, date, layers, compare, story step…). A reload keeps it, but opening the
// bare address lost everything, and opacity, the open tab and panel toggles were never kept at all. The whole view is
// therefore also saved in the browser: URL values win when present (shared links), saved values fill the rest.

const VIEW_KEY = 'view-v1';

interface SavedView {
  area: string;
  date: string;
  layers: Record<string, LayerState>;
  base: Base;
  compare: CompareMode;
  cmpA: string;
  cmpB: string;
  step: number | null;
  tab: string;
  sureOpen: boolean;
  dockOpen: boolean;
  focus: string | null;
  dash: 'closed' | 'open' | 'max';
  camera: string;
}

/** True when this page load restored a saved view (the story does not auto-start then). */
export let restoredView = false;

function readSaved(): Partial<SavedView> | null {
  try {
    const v = JSON.parse(storage.get(VIEW_KEY) ?? 'null') as Partial<SavedView> | null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

let resetting = false;

function saveView(): void {
  if (resetting) return; // the page is reloading to defaults: do not write the old view back on pagehide
  const v: SavedView = {
    area: state.area, date: state.date, layers: state.layers, base: state.base,
    compare: state.compare, cmpA: state.cmpA, cmpB: state.cmpB, step: state.step,
    tab: state.tab, sureOpen: state.sureOpen, dockOpen: state.dockOpen,
    focus: state.focus, dash: state.dash, camera: location.hash,
  };
  storage.set(VIEW_KEY, JSON.stringify(v));
}

/** Forget the saved view and reload the default page (menu: "Reset to defaults"). */
export function resetView(): void {
  resetting = true;
  window.clearTimeout(urlTimer);
  storage.remove(VIEW_KEY);
  location.replace(location.pathname);
}

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

function writeUrl(): void {
  saveView();
  const p = new URLSearchParams();
  p.set('area', state.area);
  p.set('date', state.date);
  const on = layersFor(state.area)
    .filter((l) => state.layers[l.id]?.on)
    .map((l) => l.id);
  p.set('layers', on.join(','));
  if (state.base === 'sat') p.set('base', 'sat');
  if (state.theme !== 'deep-space') p.set('theme', state.theme);
  if (state.compare !== 'off') {
    p.set('cmp', state.compare);
    if (state.compare === 'dates') p.set('pair', `${state.cmpA},${state.cmpB}`);
  }
  if (state.step !== null) p.set('step', String(state.step + 1));
  if (state.focus && state.dash !== 'closed') p.set('focus', state.focus);
  if (state.mode === 'simple' && !window.matchMedia('(max-width: 767px)').matches) p.set('mode', 'simple');
  history.replaceState(null, '', `${location.pathname}?${p.toString()}${location.hash}`);
}

export function initState(): State {
  const p = new URLSearchParams(location.search);
  const saved = readSaved();
  // A bare address (no view in the URL) restores the last saved view; a URL with a view keeps it (shared links).
  const fromSaved = !!saved && !p.has('area') && !p.has('layers') && !p.has('date');
  restoredView = fromSaved;
  const savedArea = fromSaved && cfg.areas.some((x) => x.id === saved?.area) ? (saved?.area as string) : null;
  const areaId = cfg.areas.some((a) => a.id === p.get('area')) ? (p.get('area') as string) : savedArea ?? 'kelantan';
  const a = area(areaId);
  const layers = defaultLayers();
  // Saved per-layer settings: opacity always (the URL never carries it), on/off only when restoring the saved view.
  for (const [id, ls] of Object.entries(saved?.layers ?? {})) {
    if (!layers[id] || typeof ls !== 'object' || ls === null) continue;
    if (typeof ls.opacity === 'number' && ls.opacity >= 0 && ls.opacity <= 1) layers[id].opacity = ls.opacity;
    if (fromSaved && typeof ls.on === 'boolean') layers[id].on = ls.on;
  }
  const lp = p.get('layers');
  if (lp !== null) {
    const ids = new Set(lp.split(',').filter(Boolean));
    for (const l of layersFor(areaId)) layers[l.id] = { ...layers[l.id], on: ids.has(l.id) };
  }
  // Camera: the map reads #map= from the address when it is created, so put the saved camera there first.
  if (fromSaved && !location.hash && typeof saved?.camera === 'string' && /^#map=[\d./-]+$/.test(saved.camera)) {
    history.replaceState(null, '', `${location.pathname}${location.search}${saved.camera}`);
  }
  window.addEventListener('pagehide', saveView);
  const storedTheme = storage.get('theme') as Theme | null;
  const urlTheme = p.get('theme') as Theme | null;
  const theme: Theme =
    urlTheme && THEMES.includes(urlTheme)
      ? urlTheme
      : storedTheme && THEMES.includes(storedTheme)
        ? storedTheme
        : 'deep-space'; // default for everyone (team choice, 12 Nov: star-map redesign), whatever the browser's light/dark setting
  const isMobile = window.matchMedia('(max-width: 767px)').matches;
  const urlMode = p.get('mode');
  // Expert mode is the default (team choice, 12 Nov). Phones stay simple: the HUD has no room there (plan 07 F12).
  const mode: Mode = urlMode === 'expert' ? 'expert' : urlMode === 'simple' || isMobile ? 'simple' : storage.get('mode') === 'simple' ? 'simple' : 'expert';
  let cmp = (p.get('cmp') ?? 'off') as CompareMode | '1';
  if (cmp === '1') cmp = 'dates';
  if (cmp === 'pol' && areaId !== 'kedah') cmp = 'off';
  if (!['off', 'dates', 'pol'].includes(cmp)) cmp = 'off';
  if (fromSaved && !p.has('cmp') && (saved?.compare === 'dates' || saved?.compare === 'pol')) {
    cmp = saved.compare === 'pol' && areaId !== 'kedah' ? 'off' : saved.compare;
  }
  const pair = (p.get('pair') ?? '').split(',');
  const dateParam = p.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : fromSaved && validDate(saved?.date) ? saved.date : a.default_date;
  const stepParam = Number(p.get('step'));
  const savedStep = fromSaved && typeof saved?.step === 'number' && saved.step >= 0 ? saved.step : null;
  const focusParam = p.get('focus') ?? (fromSaved && typeof saved?.focus === 'string' && saved.dash !== 'closed' ? saved.focus : null);
  state = {
    area: areaId,
    date,
    layers,
    compare: cmp as CompareMode,
    cmpA: pair[0] || (fromSaved && validDate(saved?.cmpA) ? saved.cmpA : '') || a.compare_default?.[0] || a.default_date,
    cmpB: pair[1] || (fromSaved && validDate(saved?.cmpB) ? saved.cmpB : '') || a.compare_default?.[1] || a.default_date,
    base: p.get('base') === 'sat' || (fromSaved && !p.has('base') && saved?.base === 'sat') ? 'sat' : 'map',
    theme,
    mode,
    step: stepParam >= 1 ? stepParam - 1 : savedStep,
    // Panel tab and toggles are personal settings: always taken from the saved view.
    tab: typeof saved?.tab === 'string' && saved.tab ? saved.tab : 'numbers',
    sheet: 'peek',
    playing: false,
    district: null,
    sureOpen: saved?.sureOpen === true,
    dockOpen: saved?.dockOpen !== false,
    focus: focusParam,
    dash: focusParam ? (fromSaved && saved?.dash === 'max' && !p.get('focus') ? 'max' : 'open') : 'closed',
  };
  // A restored view goes back into the address at once, so "Copy link" shares it.
  if (fromSaved) scheduleUrl();
  return state;
}
