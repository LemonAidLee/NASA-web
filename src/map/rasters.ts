// Reconcile state → raster layers on any map (main map and both compare maps use this).
// Plan 06 §6.3 rule 10: one layer per date, switched with raster-opacity; only the active date and its neighbours load.
import type { Map as MLMap, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import { cfg, dataUrl, gibsUrl, outlineId, passesFor, primaryPasses, resolveDate, studyOutlines, type LayerDef } from '../config';
import type { Base, LayerState } from '../state';
import { cssVar } from '../lib/theme';
import { t } from '../i18n';
import { syncLatest } from './latestNisar';

export interface RenderCtx {
  area: string;
  date: string;
  layers: Record<string, LayerState>;
  base: Base;
  /** Optional filter: compare "Water vs plants" hides area radar layers. */
  allow?: (l: LayerDef) => boolean;
  selectedDistrict?: string | null;
  /** District codes of the area's focus areas, and the selected one (AI-analysis dashboard). */
  focusCodes?: string[];
  focusSel?: string | null;
  /** Main map only: draws the live "newest NISAR picture" (compare maps leave it out). */
  main?: boolean;
}

const SLOTS = ['slot-sat', 'slot-context', 'slot-data', 'slot-top'] as const;
const PREFIX = 'r:';

/** Our layers go above every road/boundary line but under the labels: the first symbol after the last non-symbol layer. */
function firstSymbolId(map: MLMap): string | undefined {
  const layers = map.getStyle().layers.filter((l) => !l.id.startsWith(PREFIX) && !l.id.startsWith('slot-') && !l.id.startsWith('districts-'));
  let last = -1;
  layers.forEach((l, i) => {
    if (l.type !== 'symbol') last = i;
  });
  return layers[last + 1]?.id;
}

/**
 * Basemap labels were hard to read over radar imagery (fixed 12 Nov): OpenFreeMap "dark" draws them dim grey
 * (rgb 101,101,101) with a 70% black halo blurred by 1 px, made for a black map, not for bright pictures; and five
 * label layers (water, road names, one-way arrows) sat under our rasters and ghosted through them.
 * Here labels take theme colours with a crisp, wider halo, and every label layer is kept above our layers.
 */
const tuned = new WeakMap<MLMap, string>();
function tuneLabels(map: MLMap): void {
  const text = cssVar('--text-secondary');
  const halo = cssVar('--bg-deep');
  const key = `${text}|${halo}|${map.getStyle().layers.length}`;
  if (tuned.get(map) === key) return;
  tuned.set(map, key);
  for (const l of map.getStyle().layers) {
    // Basemap labels only: our own study-area label keeps its magenta.
    if (l.type !== 'symbol' || !l.layout?.['text-field'] || l.id.startsWith('study-')) continue;
    map.setPaintProperty(l.id, 'text-color', text);
    map.setPaintProperty(l.id, 'text-halo-color', halo);
    map.setPaintProperty(l.id, 'text-halo-width', 1.6);
    map.setPaintProperty(l.id, 'text-halo-blur', 0);
  }
}

/**
 * Deep Space theme: re-tint the OpenFreeMap "dark" basemap navy (land), near-black (water) and faint blue hairlines
 * (roads, borders), so the map reads like a star chart. Runs only when the theme defines --map-bg; the theme has its own
 * basemap URL key (lib/theme.ts), so leaving it reloads an untouched style. Never touches our data layers.
 */
const tinted = new WeakMap<MLMap, string>();
function tuneBasemap(map: MLMap): void {
  const bg = cssVar('--map-bg');
  if (!bg || tinted.get(map) === bg) return;
  tinted.set(map, bg);
  const v = (n: string) => cssVar(n);
  for (const l of map.getStyle().layers) {
    if (l.id.startsWith(PREFIX) || l.id.startsWith('slot-') || l.id.startsWith('districts-') || l.id.startsWith('study-') || l.id.startsWith('focus-')) continue;
    const id = l.id;
    if (l.type === 'background') map.setPaintProperty(id, 'background-color', bg);
    else if (l.type === 'fill') {
      const c = id === 'water' ? v('--map-water') : id === 'building' ? v('--map-building') : v('--map-land');
      map.setPaintProperty(id, 'fill-color', c);
    } else if (l.type === 'line') {
      const c = id === 'waterway' ? v('--map-water-line')
        : id.startsWith('boundary') ? v('--map-boundary')
        : /casing/.test(id) ? v('--map-road-casing')
        : v('--map-road');
      map.setPaintProperty(id, 'line-color', c);
    }
  }
}

/** Move basemap symbol layers that sit below our slots to the top, so no label is drawn under a raster. */
function liftBuriedLabels(map: MLMap): void {
  const layers = map.getStyle().layers;
  const firstSlot = layers.findIndex((l) => l.id === 'slot-sat');
  if (firstSlot < 0) return;
  for (const l of layers.slice(0, firstSlot)) {
    if (l.type === 'symbol') map.moveLayer(l.id);
  }
}

function ensureSlots(map: MLMap): void {
  tuneLabels(map);
  tuneBasemap(map);
  if (map.getLayer('slot-top')) return;
  const before = firstSymbolId(map);
  for (const id of SLOTS) {
    const spec: LayerSpecification = { id, type: 'background', layout: { visibility: 'none' }, paint: { 'background-opacity': 0 } };
    map.addLayer(spec, before);
  }
  liftBuriedLabels(map);
}

/** Is this layer drawn at all for the context? */
export function isOn(l: LayerDef, ctx: RenderCtx): boolean {
  if (!l.areas.includes(ctx.area)) return false;
  if (ctx.allow && !ctx.allow(l)) return false;
  if (l.base) return ctx.base === 'sat' || !!ctx.layers[l.id]?.on;
  return !!ctx.layers[l.id]?.on;
}

/** Date keys to keep loaded for a dated layer: the active picture plus its neighbours (preload). */
function wantedKeys(l: LayerDef, ctx: RenderCtx): { active: string | null; exact: boolean; neighbours: string[] } {
  if (l.kind === 'xyz' || l.dates === 'static') return { active: 'static', exact: true, neighbours: [] };
  const r = resolveDate(l, ctx.area, ctx.date);
  if (!r) return { active: null, exact: true, neighbours: [] };
  if (l.kind === 'image' && l.baked_dates && !l.baked_dates.includes(r.utc)) return { active: null, exact: true, neighbours: [] };
  let list: string[] = [];
  if (l.dates === 'passes') list = primaryPasses(ctx.area).filter((p) => p.gibs).map((p) => p.date_utc);
  else if (l.dates.startsWith('sensor:')) list = passesFor(ctx.area).filter((p) => p.sensor === l.dates.slice(7)).map((p) => p.date_utc);
  if (l.kind === 'image' && l.baked_dates) list = list.filter((d) => l.baked_dates?.includes(d));
  const i = list.indexOf(r.utc);
  const neighbours = i < 0 ? [] : [list[i - 1], list[i + 1]].filter((x): x is string => !!x);
  return { active: r.utc, exact: r.exact, neighbours };
}

function addRaster(map: MLMap, l: LayerDef, key: string): void {
  const id = `${PREFIX}${l.id}@${key}`;
  if (map.getLayer(id)) return;
  if (l.kind === 'image') {
    // A picture baked by our pipeline (pipeline/bake.py): one PNG per date, already in Web Mercator, placed by corners.
    if (!l.corners) return;
    if (!map.getSource(id)) map.addSource(id, { type: 'image', url: dataUrl(l.url.replace('{date}', key)), coordinates: l.corners });
  } else if (!map.getSource(id)) {
    const { url, tileSize } = l.kind === 'gibs' ? gibsUrl(l, key) : { url: l.url, tileSize: 256 };
    map.addSource(id, {
      type: 'raster',
      tiles: [url],
      tileSize,
      maxzoom: l.maxzoom ?? 14,
      attribution: l.attribution,
    });
  }
  map.addLayer(
    {
      id,
      type: 'raster',
      source: id,
      layout: { visibility: 'visible' },
      paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 400, delay: 0 }, 'raster-fade-duration': 150 },
    },
    `slot-${l.slot}`,
  );
}

export function syncRasters(map: MLMap, ctx: RenderCtx): void {
  // Style still loading: callers re-run this on 'style.load'.
  try {
    ensureSlots(map);
  } catch {
    return;
  }
  const existing = map.getStyle().layers.filter((x) => x.id.startsWith(PREFIX)).map((x) => x.id);

  for (const l of cfg.layers) {
    if (l.kind === 'browse') {
      if (ctx.main) syncLatest(map, ctx.area, isOn(l, ctx), ctx.layers[l.id]?.opacity ?? l.opacity);
      continue;
    }
    if (l.status !== 'real' || (l.kind !== 'gibs' && l.kind !== 'xyz' && l.kind !== 'image')) continue;
    const mine = existing.filter((id) => id.startsWith(`${PREFIX}${l.id}@`));
    if (!isOn(l, ctx)) {
      for (const id of mine) map.setLayoutProperty(id, 'visibility', 'none');
      continue;
    }
    const { active, exact, neighbours } = wantedKeys(l, ctx);
    if (active) addRaster(map, l, active);
    for (const n of neighbours) addRaster(map, l, n);
    const keep = new Set([active, ...neighbours].filter(Boolean).map((k) => `${PREFIX}${l.id}@${k}`));
    const all = map.getStyle().layers.filter((x) => x.id.startsWith(`${PREFIX}${l.id}@`)).map((x) => x.id);
    const opacity = (ctx.layers[l.id]?.opacity ?? l.opacity) * (exact ? 1 : 0.35);
    for (const id of all) {
      if (id === `${PREFIX}${l.id}@${active}`) {
        map.setLayoutProperty(id, 'visibility', 'visible');
        map.setPaintProperty(id, 'raster-opacity', opacity);
      } else if (keep.has(id)) {
        map.setLayoutProperty(id, 'visibility', 'visible');
        map.setPaintProperty(id, 'raster-opacity', 0);
      } else {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
    }
  }
  syncDistricts(map, ctx);
  syncStudyAreas(map, ctx);
}

/** Remove date layers that piled up in imagery-only areas (any day can be picked there). */
export function pruneExplore(map: MLMap, keepUtc: string): void {
  for (const l of map.getStyle().layers) {
    if (!l.id.startsWith(`${PREFIX}exp_`) && !l.id.startsWith(`${PREFIX}live_`) && !l.id.startsWith(`${PREFIX}sat@`)) continue;
    if (l.id.endsWith(`@${keepUtc}`)) continue;
    map.removeLayer(l.id);
    if (map.getSource(l.id)) map.removeSource(l.id);
  }
}

// ---------- study-area outlines (where our maps have data) ----------

/** Outline of the study districts (data/study_areas.geojson, built by scripts/make-study-areas.mjs) plus a label
 *  point at each outline's northernmost vertex. */
function studyAreasGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const o of studyOutlines) {
    const a = cfg.areas.find((x) => x.id === o.properties.id);
    if (!a) continue;
    const rings = (o.geometry.type === 'Polygon' ? [o.geometry.coordinates] : o.geometry.coordinates) as number[][][][];
    let top: number[] = rings[0][0][0];
    for (const poly of rings) for (const pt of poly[0]) if (pt[1] > top[1]) top = pt;
    features.push({ type: 'Feature', properties: { id: a.id }, geometry: o.geometry as GeoJSON.Geometry });
    features.push({ type: 'Feature', properties: { id: a.id, label: t('study.label', { area: t(a.short) }).toUpperCase() }, geometry: { type: 'Point', coordinates: [top[0], top[1]] } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Study-district outline; the active area at full strength. Changed 12 Nov: a pale dotted line vanished over the
 * green/yellow/pink NISAR paddy picture, so it is now bold magenta dashes on a solid black edge. Magenta is the
 * complement of the paddy greens, is not a UI accent, not an Okabe–Ito data class and not an alarm colour
 * (plan 14 §3.3 rules 2 and 4). Colours come from layers.json (legend_colors.study) and do not change with the theme.
 */
export function syncStudyAreas(map: MLMap, ctx: RenderCtx): void {
  const { line, casing } = cfg.legend_colors.study;
  if (!map.getSource('study-areas')) map.addSource('study-areas', { type: 'geojson', data: studyAreasGeoJSON() });
  if (!map.getLayer('study-line')) {
    const isLine: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
    map.addLayer({ id: 'study-casing', type: 'line', source: 'study-areas', filter: isLine, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 4, 10, 6.5] } }, 'slot-top');
    map.addLayer({ id: 'study-line', type: 'line', source: 'study-areas', filter: isLine, layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-color': line, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 3.2], 'line-dasharray': [2.2, 1.2] } }, 'slot-top');
    map.addLayer({
      id: 'study-label', type: 'symbol', source: 'study-areas', filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-letter-spacing': 0.12, 'text-anchor': 'bottom', 'text-offset': [0, -0.6], 'text-allow-overlap': true },
      paint: { 'text-color': line, 'text-halo-color': casing, 'text-halo-width': 2 },
    });
    // Topmost label layer: placed first, so basemap names make room for it instead of printing over it.
  }
  const own = outlineId(ctx.area);
  const strength: ExpressionSpecification = ['case', ['==', ['get', 'id'], own], 1, 0.45];
  map.setPaintProperty('study-line', 'line-opacity', strength);
  map.setPaintProperty('study-casing', 'line-opacity', ['case', ['==', ['get', 'id'], own], 0.9, 0.4]);
  map.setPaintProperty('study-label', 'text-opacity', strength);
}

// ---------- district borders (DOSM) ----------

export function syncDistricts(map: MLMap, ctx: RenderCtx): void {
  const def = cfg.layers.find((l) => l.id === 'districts');
  if (!def) return;
  if (!map.getSource('districts')) {
    // promoteId lets hover use feature-state keyed by the DOSM district code.
    map.addSource('districts', { type: 'geojson', data: new URL(def.url, document.baseURI).href, attribution: def.attribution, promoteId: 'code' });
  }
  const line = cssVar('--text-secondary');
  const sel = cssVar('--brand');
  if (!map.getLayer('districts-fill')) {
    map.addLayer(
      {
        id: 'districts-fill', type: 'fill', source: 'districts',
        paint: { 'fill-color': line, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0], 'fill-opacity-transition': { duration: 150, delay: 0 } },
      },
      'slot-top',
    );
    map.addLayer(
      { id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': line, 'line-opacity': 0.55, 'line-width': 0.9, 'line-dasharray': [3, 2] } },
      'slot-top',
    );
    map.addLayer(
      { id: 'districts-sel', type: 'line', source: 'districts', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': sel, 'line-width': 2.5 } },
      'slot-top',
    );
  } else {
    map.setPaintProperty('districts-line', 'line-color', line);
    map.setPaintProperty('districts-sel', 'line-color', sel);
  }
  const vis = isOn(def, ctx) ? 'visible' : 'none';
  for (const id of ['districts-fill', 'districts-line']) map.setLayoutProperty(id, 'visibility', vis);
  map.setLayoutProperty('districts-sel', 'visibility', ctx.selectedDistrict ? 'visible' : 'none');
  map.setFilter('districts-sel', ['==', ['get', 'code'], ctx.selectedDistrict ?? '']);
  syncFocusOutlines(map, ctx);
}

/** Solid outline on the focus-area districts (AI dashboard); the selected one bold with a dark edge.
 *  Neutral theme text colour: distinct from the magenta dashed study outline and the dim dashed district lines. */
function syncFocusOutlines(map: MLMap, ctx: RenderCtx): void {
  const line = cssVar('--text');
  const casing = cssVar('--bg-deep');
  if (!map.getLayer('focus-line')) {
    map.addLayer({ id: 'focus-casing', type: 'line', source: 'districts', filter: ['==', ['get', 'code'], ''], layout: { 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': 5, 'line-opacity': 0.8 } }, 'slot-top');
    map.addLayer({ id: 'focus-line', type: 'line', source: 'districts', filter: ['==', ['get', 'code'], ''], layout: { 'line-join': 'round' }, paint: { 'line-color': line, 'line-width': 1.4, 'line-opacity': 0.85 } }, 'slot-top');
  }
  const codes = ctx.focusCodes ?? [];
  const sel = ctx.focusSel ?? '';
  map.setFilter('focus-line', ['in', ['get', 'code'], ['literal', codes]]);
  map.setFilter('focus-casing', ['==', ['get', 'code'], sel]);
  map.setPaintProperty('focus-line', 'line-color', line);
  map.setPaintProperty('focus-line', 'line-width', ['case', ['==', ['get', 'code'], sel], 3, 1.4]);
  map.setPaintProperty('focus-casing', 'line-color', casing);
}
