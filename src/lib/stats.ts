// Numbers from our radar maps (public/data/stats.json, written by pipeline/08_stats.py).
// Every accessor returns null when the pipeline has not produced the number, so the UI can fall back to "—".
import { layer, resolveDate } from '../config';
import { locale } from '../i18n';

export interface KelDistrict {
  district: string;
  study: boolean;
  flood_ha: number;
  flood_ha_low: number;
  flood_ha_high: number;
  possible_ha: number;
  permanent_ha: number;
  change_ha: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface KelDate {
  date_myt: string;
  track: string;
  reference: string | null;
  threshold_db: number;
  threshold_method: string;
  capped: boolean;
  flood_ha: number;
  flood_ha_low: number;
  flood_ha_high: number;
  possible_ha: number;
  top_district: string | null;
  water_median_db: number | null;
  land_median_db: number;
  districts: Record<string, KelDistrict>;
}

export interface KedDate {
  date_myt: string;
  track: string;
  pct_field_water: number;
  pct_low: number;
  pct_high: number;
  water_ha: number;
  paddy_ha_seen: number;
  hh_water_median_db: number | null;
  hh_land_median_db: number;
  hv_water_median_db: number | null;
  hv_land_median_db: number;
  districts: Record<string, { district: string; study: boolean; pct_field_water: number; cropland_ha_seen: number }>;
}

interface Range {
  median: number;
  min: number;
  max: number;
}

export interface Validation {
  framing: string;
  per_date: Record<string, { f1: number; iou: number; kappa: number | null; oa: number; date_gap_days: number; dswx_date?: string }>;
  summary: { f1?: Range; iou?: Range; kappa?: Range; oa?: Range; date_gap_days?: Range };
}

export interface Stats {
  kelantan: { dates: Record<string, KelDate>; impact?: KelImpact };
  kedah: {
    dates: Record<string, KedDate>;
    first_flooded_ha: Record<string, number>;
    stacks: Record<string, { HH: { threshold_db: number; method: string; ashman_d: number }; HV: { threshold_db: number; method: string; ashman_d: number }; dates: string[] }>;
    districts: Record<string, { district: string; study: boolean; cropland_ha: number; first_flooded_ha: Record<string, number> }>;
    /** pipeline/12_impact.py: per-pass water verdicts as bits (red = water, green = data), for the spot history. */
    wetbits?: { url: string; corners: [number, number][]; dates: string[] };
  };
  validation: { kelantan?: Validation; kedah?: Validation };
  histograms?: {
    kelantan?: { band: string; where: string; threshold_db: number; dates: Record<string, Hist> };
    kedah?: { stack: string; where: string; threshold_db: { HH: number; HV: number }; dates: { HH: Record<string, Hist>; HV: Record<string, Hist> } };
  };
}

/** pipeline/12_impact.py: people near new flood water (WorldPop 2024) and how many passes each spot stayed flooded. */
export interface KelImpact {
  population: string;
  near_m: number;
  pass_gap_days: number;
  dates: Record<string, { people_in: number; people_near: number; districts: Record<string, { people_in: number; people_near: number }> }>;
  duration: {
    districts: Record<string, { district: string; study: boolean; ha_1: number; ha_2: number; ha_3: number; ha_12days: number }>;
    total: { ha_1: number; ha_2: number; ha_3: number; ha_12days: number };
  };
  district_population: Record<string, number>;
}

export interface Hist {
  lo: number;
  step: number;
  pct: number[];
  n: number;
}

export interface RainArea {
  source: { name: string; short: string; kind: 'satellite' | 'reanalysis'; resolution: string; doi?: string; url?: string };
  start: string;
  end: string;
  daily: Record<string, number>;
  peak: { date: string | null; mm: number | null };
}

export let stats: Stats | null = null;
/** Daily study-box rainfall (public/data/rain.json, written by pipeline/10_rainfall.py). */
export let rain: Record<string, RainArea> | null = null;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(path, document.baseURI).href);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function loadStats(): Promise<void> {
  const [st, rn] = await Promise.all([getJson<Stats>('data/stats.json'), getJson<Record<string, RainArea>>('data/rain.json')]);
  stats = st;
  rain = rn;
}

/** The radar pass (UTC date key) whose map is shown for a selected MYT date, via the area's main layer. */
function passKey(layerId: string, areaId: string, date: string): string | null {
  const l = layer(layerId);
  if (!l) return null;
  return resolveDate(l, areaId, date)?.utc ?? null;
}

export function kelPass(date: string): (KelDate & { utc: string }) | null {
  const k = passKey('kel_flood', 'kelantan', date);
  const d = k ? stats?.kelantan.dates[k] : undefined;
  return d && k ? { ...d, utc: k } : null;
}

export function kedPass(date: string): (KedDate & { utc: string }) | null {
  const k = passKey('ked_hh', 'kedah', date);
  const d = k ? stats?.kedah.dates[k] : undefined;
  return d && k ? { ...d, utc: k } : null;
}

export function kedDateByUtc(utc: string): KedDate | null {
  return stats?.kedah.dates[utc] ?? null;
}

const nf = new Intl.NumberFormat(locale);
export const ha = (n: number): string => `${nf.format(Math.round(n))} ha`;
export const haRange = (lo: number, hi: number): string => `${nf.format(Math.round(lo))}–${nf.format(Math.round(hi))} ha`;

/** One-line headline for an area and date: our measured number when the pipeline made it, else the panel text. */
export function areaHeadline(areaId: string, date: string, panelKey: string, fmt: (d: string) => string, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (areaId === 'kelantan') {
    const p = kelPass(date);
    if (p) return p.reference
      ? t('kel.headline', { ha: ha(p.flood_ha), range: haRange(p.flood_ha_low, p.flood_ha_high), date: fmt(p.date_myt) })
      : t('kel.headline.ref', { date: fmt(p.date_myt) });
  }
  if (areaId === 'kedah') {
    const p = kedPass(date);
    if (p) return t('ked.headline', { pct: p.pct_field_water, lo: p.pct_low, hi: p.pct_high, date: fmt(p.date_myt) });
  }
  return t(panelKey, { date: fmt(date) });
}
