// Main map (F1): OpenFreeMap basemap, raster sync, area fit, theme swap (F19).
import { Map as MLMap, NavigationControl, ScaleControl, AttributionControl } from 'maplibre-gl';
import { area, focusById, focusFor, layersFor, studyBbox, type LayerDef } from '../config';
import * as S from '../state';
import { basemapStyle } from '../lib/theme';
import { pruneExplore, syncRasters, type RenderCtx } from './rasters';
import { t } from '../i18n';
import { isMoved } from '../ui/windows';

export let map: MLMap;
let currentTheme: S.Theme;

export function ctxFrom(s: S.State, extra: Partial<RenderCtx> = {}): RenderCtx {
  const focus = focusFor(s.area);
  const sel = s.dash !== 'closed' ? focusById(s.focus)?.code ?? null : null;
  return { area: s.area, date: s.date, layers: s.layers, base: s.base, selectedDistrict: s.district, focusCodes: focus.map((f) => f.code), focusSel: sel, ...extra };
}

/** District hover highlight (feature-state on the DOSM source). */
function initDistrictHover(): void {
  let hovered: string | number | null = null;
  const clear = () => {
    if (hovered !== null && map.getSource('districts')) map.setFeatureState({ source: 'districts', id: hovered }, { hover: false });
    hovered = null;
  };
  map.on('mousemove', 'districts-fill', (e) => {
    const id = e.features?.[0]?.id;
    if (id === undefined || id === hovered) return;
    clear();
    hovered = id;
    map.setFeatureState({ source: 'districts', id }, { hover: true });
  });
  map.on('mouseleave', 'districts-fill', clear);
}

export function createMap(container: HTMLElement): MLMap | null {
  const s = S.get();
  currentTheme = s.theme;
  const a = area(s.area);
  try {
    map = new MLMap({
      container,
      style: basemapStyle(s.theme),
      bounds: studyBbox(a.id),
      fitBoundsOptions: { padding: fitPadding() },
      hash: 'map',
      attributionControl: false,
      maxZoom: 14,
      canvasContextAttributes: { preserveDrawingBuffer: false },
    });
  } catch (err) {
    // MapLibre v6 throws GPUInitializationError from the constructor when WebGL2 is missing (plan 06 §1.3 a).
    container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'map-error';
    p.textContent = t('err.webgl');
    container.append(p);
    console.error(err);
    return null;
  }
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-left');

  map.on('style.load', () => syncRasters(map, ctxFrom(S.get())));
  map.once('load', initDistrictHover); // after the first style.load has added 'districts-fill'
  // OpenFreeMap styles reference a few sprite icons they do not ship (e.g. "circle-11"): draw nothing for them.
  map.setMissingStyleImageResolver(() => undefined);

  // GIBS answers 404 for days it has no tile (e.g. DSWx-S1 on 23 Nov 2024). That is an empty picture, not an error.
  map.on('error', (e) => {
    const msg = String((e as { error?: { message?: string; status?: number } }).error?.message ?? '');
    if (/\((404|500|502|503)\)|Not Found/i.test(msg) && /gibs\.earthdata/.test(msg)) return;
    console.warn('[map]', msg);
  });

  S.subscribe((st, changed) => {
    if (changed.has('theme') && st.theme !== currentTheme) {
      const swapStyle = basemapStyle(st.theme) !== basemapStyle(currentTheme);
      currentTheme = st.theme;
      if (swapStyle) map.setStyle(basemapStyle(st.theme)); // rasters re-added on style.load
      else syncRasters(map, ctxFrom(st));
      return;
    }
    if (changed.has('area')) {
      const a2 = area(st.area);
      if (st.step === null && a2.kind !== 'explore') fitArea(studyBbox(a2.id));
    }
    if (['area', 'date', 'layers', 'base', 'district', 'focus', 'dash'].some((k) => changed.has(k as keyof S.State))) {
      if (st.area === 'explore') pruneExplore(map, st.date);
      syncRasters(map, ctxFrom(st));
    }
  });
  return map;
}

/** Padding that keeps a fitted area clear of the side columns (desktop) or the bottom sheet (phone),
 *  so the whole dotted study-area box is in view. */
export function fitPadding(): { top: number; bottom: number; left: number; right: number } {
  const stage = document.getElementById('stage')?.getBoundingClientRect();
  if (!stage) return { top: 40, bottom: 40, left: 40, right: 40 };
  if (window.matchMedia('(max-width: 767px)').matches) {
    const sheet = document.getElementById('sheet')?.getBoundingClientRect().height || 200;
    return { top: 56, bottom: Math.min(sheet + 16, stage.height * 0.5), left: 16, right: 16 };
  }
  const left = document.getElementById('leftcol')?.getBoundingClientRect();
  const right = document.getElementById('panel')?.getBoundingClientRect();
  // Panels the user moved (ui/windows.ts) no longer block the edges, so they are left out of the framing.
  const leftDocked = !!document.getElementById('leftcol')?.children.length;
  const leftPad = leftDocked && left && left.width && !document.body.classList.contains('story-on') ? left.right - stage.left + 24 : 40;
  const rightPad = !isMoved('panel') && right && right.width && !document.body.classList.contains('story-on') ? stage.right - right.left + 24 : 40;
  // Never squeeze the map below a third of the width.
  const room = stage.width - leftPad - rightPad;
  if (room < stage.width / 3) return { top: 32, bottom: 32, left: 40, right: 40 };
  return { top: 64, bottom: 40, left: leftPad, right: rightPad }; // top clears the focus-area launcher bar
}

export function fitArea(bbox: [number, number, number, number], animate = true): void {
  map.fitBounds(bbox, { padding: fitPadding(), duration: animate && !reduced() ? 1200 : 0 });
}

export function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function flyTo(center: [number, number], zoom: number): void {
  if (reduced()) map.jumpTo({ center, zoom });
  else map.flyTo({ center, zoom, duration: 1600, essential: true });
}

/** Layers of the active area that are on and real (for counts and popup wording). */
export function visibleLayers(s: S.State): LayerDef[] {
  return layersFor(s.area).filter((l) => (l.base ? s.base === 'sat' || s.layers[l.id]?.on : s.layers[l.id]?.on));
}
