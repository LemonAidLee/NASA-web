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

function writeUrl(): void {
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
  const areaId = cfg.areas.some((a) => a.id === p.get('area')) ? (p.get('area') as string) : 'kelantan';
  const a = area(areaId);
  const layers = defaultLayers();
  const lp = p.get('layers');
  if (lp !== null) {
    const ids = new Set(lp.split(',').filter(Boolean));
    for (const l of layersFor(areaId)) layers[l.id] = { ...layers[l.id], on: ids.has(l.id) };
  }
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
  const pair = (p.get('pair') ?? '').split(',');
  const dateParam = p.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : a.default_date;
  const stepParam = Number(p.get('step'));
  state = {
    area: areaId,
    date,
    layers,
    compare: cmp as CompareMode,
    cmpA: pair[0] || a.compare_default?.[0] || a.default_date,
    cmpB: pair[1] || a.compare_default?.[1] || a.default_date,
    base: p.get('base') === 'sat' ? 'sat' : 'map',
    theme,
    mode,
    step: stepParam >= 1 ? stepParam - 1 : null,
    tab: 'numbers',
    sheet: 'peek',
    playing: false,
    district: null,
    sureOpen: false,
    dockOpen: true,
    focus: p.get('focus'),
    dash: p.get('focus') ? 'open' : 'closed',
  };
  return state;
}
