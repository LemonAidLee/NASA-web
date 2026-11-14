import { lang, locale } from './i18n';
// Types and helpers for the layers.json / passes.json contract (plan 06 §4, 04 §4.1).
import { gibsTileTemplate } from './lib/gibs';
import type { CollectionKey } from './lib/catalog';

/** live = a fixed place watched with NASA's ready-made pictures up to today (no baked maps, any day pickable). */
export type AreaKind = 'disaster' | 'agri' | 'explore' | 'live';
/** browse = the newest NISAR pass's public browse picture, found live through the ASF Search API. */
export type LayerKind = 'class' | 'db' | 'rgb' | 'gibs' | 'xyz' | 'vector' | 'browse' | 'image';

/** Areas that show only NASA's ready-made pictures, with a free date picker instead of pass stepping. */
export const imageryOnly = (a: { kind: AreaKind }): boolean => a.kind === 'explore' || a.kind === 'live';

export interface ClassDef {
  code: number;
  name: string;
  color?: string;
  style?: 'hatch' | 'hatch-fill' | 'none';
  confidence: string;
}

export interface Phase {
  id: string;
  start: string;
  end: string;
  ha: number;
}

export interface Preset {
  label: string;
  center: [number, number];
  zoom: number;
  date: string;
}

export interface Panel {
  question: string;
  sensor: string;
  headline: string;
  numbers_tab?: string;
  numbers_tab_expert?: string;
  validation?: string;
  official?: string;
  official_links: { label: string; url: string }[];
  sure_first: string[];
  sure_lines: string[];
  legend_layer?: string;
  pulse_label?: string;
}

export interface Area {
  id: string;
  kind: AreaKind;
  name: string;
  short: string;
  bbox: [number, number, number, number];
  default_date: string;
  strip?: [string, string];
  revisit_days?: number;
  compare_default?: [string, string];
  states?: string[];
  phases?: Phase[];
  date_range?: [string, string];
  presets?: Preset[];
  /** DOSM districts with at least half their area inside the radar box; their merged outline is drawn on the map. */
  study_districts?: string[];
  /** Use another area's study outline (the live Kelantan view reuses Kelantan's). */
  outline?: string;
  /** Where the destination picker draws this area's node, when its box centre is taken by another area. */
  pick_at?: [number, number];
  /** Learn-more links shown in "How sure are we?". */
  learn_links?: { label: string; url: string }[];
  panel: Panel;
}

export interface StudyOutline {
  type: 'Feature';
  properties: { id: string; districts: string[]; bbox: [number, number, number, number] };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

export interface LayerDef {
  id: string;
  areas: string[];
  group: string;
  name: string;
  simple: boolean;
  expert_only?: boolean;
  kind: LayerKind;
  status: 'real' | 'placeholder';
  preview?: boolean;
  url: string;
  dates: string; // passes | static | daily | fixed | sensor:<name>
  fixed_date?: string;
  maxzoom?: number;
  slot: 'sat' | 'context' | 'data' | 'top';
  on: boolean;
  opacity: number;
  base?: boolean;
  info: string;
  legend?: string;
  classes?: ClassDef[];
  exclusive_with?: string[];
  values_from?: string[];
  range?: [number, number];
  attribution?: string;
  swatch?: string[];
  /** GIBS WMS layer name: served through WMS because its WMTS tiles are unreliable (see lib/gibs.ts). */
  wms_layer?: string;
  /** Short code for socket buttons and inspect cards. */
  abbr?: string;
  /** NASA collection behind this layer, for the "Get this data" links. */
  collection?: CollectionKey;
  /** kind=image: lon/lat corners (NW, NE, SE, SW) of the baked PNG per date key ("static" for one picture). */
  corners?: [[number, number], [number, number], [number, number], [number, number]];
  /** kind=image: dates for which a baked picture exists. */
  baked_dates?: string[];
  /** kind=image grey pictures: grey 1–255 spread linearly over this dB range (pipeline/09_bake_web.py). */
  encoding?: { type: 'grey'; range: [number, number] };
  /** Fixed per-channel stretch of the HH/HV composite, in dB. */
  stretch?: Record<string, [number, number]>;
}

export interface Pass {
  area: string;
  date_utc: string;
  time_utc: string;
  date_myt: string;
  time_myt: string;
  sensor: string;
  track: string;
  direction: 'A' | 'D';
  product: string;
  primary: boolean;
  coverage_flag: 'full' | 'partial' | 'rough';
  gibs: boolean;
}

export interface Config {
  gibs_base: string;
  areas: Area[];
  layers: LayerDef[];
  legend_colors: Record<string, Record<string, string>>;
}

export interface Story {
  steps: StoryStep[];
}
export interface StoryStep {
  title: string;
  body: string;
  bridge?: string;
  footer?: string;
  global?: string;
  action?: { label: string; do: string };
  action2?: { label: string; do: string };
  camera: { center: [number, number]; zoom: number };
  state: { area: string; date: string; base: 'map' | 'sat'; compare: 'off'; layers: Record<string, boolean> };
}

export interface Provenance {
  latest_nisar_baked: Record<string, string>;
  granules: { area: string; product: string; id: string }[];
}

export let cfg: Config;
export let passes: Pass[] = [];
export let story: Story;
export let provenance: Provenance;
export let studyOutlines: StudyOutline[] = [];

export interface SourcedLine {
  text: string;
  src: string;
  url: string;
}
export interface FocusArea {
  id: string;
  district: string;
  code: string;
  center: [number, number];
  title: string;
  tagline: string;
  facts: SourcedLine[];
  drivers: SourcedLine[];
  ai_focus: string;
  ai_draft: string;
  events: { date: string; label: string }[];
  /** Measured from DOSM boundaries by scripts/make-focus-areas.mjs. */
  area_km2: number;
  inside_pct: number;
}
export let focusMeta: { generated_by: string; reviewed: boolean } = { generated_by: '', reviewed: false };
export interface Method {
  glyph: string;
  name: string;
  text: string;
  status: 'event' | 'planned';
}
export interface MethodGroup {
  group: string;
  items: Method[];
}
let methods: Record<string, MethodGroup[]> = {};
export const methodsFor = (areaId: string): MethodGroup[] => methods[areaId] ?? [];
let focusAreas: Record<string, FocusArea[]> = {};
export const focusFor = (areaId: string): FocusArea[] => focusAreas[areaId] ?? [];
export const focusById = (id: string | null): FocusArea | undefined =>
  id ? Object.values(focusAreas).flat().find((f) => f.id === id) : undefined;
export const areaOfFocus = (id: string): string | undefined => Object.keys(focusAreas).find((a) => focusAreas[a].some((f) => f.id === id));

/** Camera box for an area: its study-district outline when there is one, else the radar box. */
export function studyBbox(areaId: string): [number, number, number, number] {
  return studyOutlines.find((o) => o.properties.id === outlineId(areaId))?.properties.bbox ?? area(areaId).bbox;
}

/** Which study outline belongs to an area (itself, or the area it borrows one from). */
export function outlineId(areaId: string): string {
  return cfg.areas.find((a) => a.id === areaId)?.outline ?? areaId;
}

export function dataUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(path);
  return (await res.json()) as T;
}

export async function loadConfig(): Promise<void> {
  const [c, p, s, pr, so, fo] = await Promise.all([
    getJson<Config>('data/layers.json'),
    getJson<{ passes: Pass[] }>('data/passes.json'),
    getJson<Story>('data/story.json'),
    getJson<Provenance>('data/provenance.json'),
    getJson<{ features: StudyOutline[] }>('data/study_areas.geojson'),
    getJson<{ meta: typeof focusMeta; areas: Record<string, FocusArea[]>; methods: Record<string, MethodGroup[]> }>('data/focus_areas.json'),
  ]);
  studyOutlines = so.features;
  if (lang === 'ms') await applyMalay(fo);
  focusAreas = fo.areas;
  focusMeta = fo.meta;
  methods = fo.methods ?? {};
  // "today" in a date range means the viewer's current UTC day, so imagery areas never go stale.
  const today = new Date().toISOString().slice(0, 10);
  for (const a of c.areas) if (a.date_range?.[1] === 'today') a.date_range = [a.date_range[0], today];
  cfg = c;
  passes = p.passes.slice().sort((a, b) => (a.date_myt < b.date_myt ? -1 : a.date_myt > b.date_myt ? 1 : 0));
  story = s;
  provenance = pr;
}

interface FocusMs {
  areas: Record<string, { title?: string; tagline?: string; facts?: string[]; drivers?: string[]; events?: string[]; ai_draft?: string; ai_focus?: string }>;
  methods?: Record<string, { group: string; items: { name: string; text: string }[] }[]>;
}

/** Bahasa Melayu text for the focus districts and methods (public/data/focus_areas.ms.json), laid over the English
 *  by id and position; anything missing stays in English. Sources stay as cited. */
async function applyMalay(fo: { areas: Record<string, FocusArea[]>; methods: Record<string, MethodGroup[]> }): Promise<void> {
  let m: FocusMs;
  try {
    m = await getJson<FocusMs>('data/focus_areas.ms.json');
  } catch {
    return;
  }
  for (const f of Object.values(fo.areas).flat()) {
    const x = m.areas[f.id];
    if (!x) continue;
    if (x.title) f.title = x.title;
    if (x.tagline) f.tagline = x.tagline;
    if (x.ai_draft) f.ai_draft = x.ai_draft;
    if (x.ai_focus) f.ai_focus = x.ai_focus;
    x.facts?.forEach((txt, i) => f.facts[i] && (f.facts[i].text = txt));
    x.drivers?.forEach((txt, i) => f.drivers[i] && (f.drivers[i].text = txt));
    x.events?.forEach((txt, i) => f.events[i] && (f.events[i].label = txt));
  }
  for (const [areaId, groups] of Object.entries(m.methods ?? {})) {
    groups.forEach((g, gi) => {
      const target = fo.methods?.[areaId]?.[gi];
      if (!target) return;
      target.group = g.group;
      g.items.forEach((it, ii) => target.items[ii] && Object.assign(target.items[ii], it));
    });
  }
}

export function area(id: string): Area {
  return cfg.areas.find((a) => a.id === id) ?? cfg.areas[0];
}

export function layersFor(areaId: string): LayerDef[] {
  return cfg.layers.filter((l) => l.areas.includes(areaId));
}

export function layer(id: string): LayerDef | undefined {
  return cfg.layers.find((l) => l.id === id);
}

export function passesFor(areaId: string): Pass[] {
  return passes.filter((p) => p.area === areaId);
}

export function primaryPasses(areaId: string): Pass[] {
  return passesFor(areaId).filter((p) => p.primary);
}

// ---------- dates (all YYYY-MM-DD strings; calendar days in MYT) ----------

const DAY = 86_400_000;
export function toMs(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}
export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  return fromMs(toMs(d) + n * DAY);
}
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(a) - toMs(b)) / DAY);
}
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const fmtLong = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtFull = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (d: string): string => fmtLong.format(new Date(toMs(d)));
export const fmtDay = (d: string): string => fmtShort.format(new Date(toMs(d)));
export const fmtDateFull = (d: string): string => fmtFull.format(new Date(toMs(d)));
export const fmtNum = (n: number): string => new Intl.NumberFormat(locale).format(n);

/** Nearest item by date; ties go to the earlier one. */
export function nearest<T>(items: T[], date: string, key: (t: T) => string): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const it of items) {
    const d = Math.abs(diffDays(key(it), date));
    if (d < bestD || (d === bestD && best && key(it) < key(best))) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

export interface Resolved {
  myt: string; // the calendar day the picture belongs to
  utc: string; // the date used in the tile URL
  exact: boolean;
  age: number; // days between the selected date and the picture (signed: picture − selected)
}

/** Which picture of a layer to show for the selected date (plan 07 F3: nearest pass, never full strength on another day). */
export function resolveDate(l: LayerDef, areaId: string, date: string): Resolved | null {
  if (l.dates === 'static') return { myt: date, utc: date, exact: true, age: 0 };
  if (l.dates === 'daily') return { myt: date, utc: date, exact: true, age: 0 };
  if (l.dates === 'fixed' && l.fixed_date) {
    return { myt: l.fixed_date, utc: l.fixed_date, exact: true, age: 0 };
  }
  let list: Pass[] = [];
  if (l.dates === 'passes') list = primaryPasses(areaId);
  else if (l.dates.startsWith('sensor:')) {
    const s = l.dates.slice(7);
    list = passesFor(areaId).filter((p) => p.sensor === s);
  }
  if (l.kind === 'gibs') list = list.filter((p) => p.gibs);
  const p = nearest(list, date, (x) => x.date_myt);
  if (!p) return null;
  return { myt: p.date_myt, utc: p.date_utc, exact: p.date_myt === date, age: diffDays(p.date_myt, date) };
}

export function gibsUrl(l: LayerDef, utc: string): { url: string; tileSize: number } {
  return gibsTileTemplate(l, utc, cfg.gibs_base);
}
