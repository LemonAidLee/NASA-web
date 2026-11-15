// F6 before/after swipe and F33 "Water vs plants" (Kedah). Uses maplibre-gl-compare 0.5.0 with the plan's fixes:
// `events` installed, a local `declare module`, and both containers absolutely positioned (plan 06 §1.3 item 2).
import Compare from '@maplibre/maplibre-gl-compare';
import '@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css';
import { Map as MLMap, AttributionControl } from 'maplibre-gl';
import { area, imageryOnly, fmtDate, layersFor, primaryPasses, type Pass } from '../config';
import { t } from '../i18n';
import { $, clear, h } from '../lib/dom';
import { basemapStyle } from '../lib/theme';
import * as S from '../state';
import { ctxFrom, map } from './mainMap';
import { syncRasters } from './rasters';

let mapA: MLMap | null = null;
let mapB: MLMap | null = null;
let cmp: Compare | null = null;
let openKey = '';

export function initCompare(): void {
  S.subscribe((s, ch) => {
    if (ch.has('area') && s.compare === 'pol' && s.area !== 'kedah') {
      S.set({ compare: 'off' });
      return;
    }
    if (ch.has('area') && s.compare !== 'off' && imageryOnly(area(s.area))) {
      S.set({ compare: 'off' });
      return;
    }
    if (ch.has('compare') || ch.has('area') || ch.has('theme')) {
      if (s.compare === 'off') close();
      else open();
      return;
    }
    if (s.compare !== 'off' && ['cmpA', 'cmpB', 'date', 'layers', 'district', 'mode'].some((k) => ch.has(k as keyof S.State))) refresh();
  });
  if (S.get().compare !== 'off') map.once('load', () => open());
}

function sideDates(s: S.State): [string, string] {
  return s.compare === 'pol' ? [s.date, s.date] : [s.cmpA, s.cmpB];
}

function passFor(areaId: string, date: string): Pass | undefined {
  return primaryPasses(areaId).find((p) => p.date_myt === date);
}

function isRough(s: S.State): boolean {
  if (s.compare !== 'dates') return false;
  const a = passFor(s.area, s.cmpA);
  const b = passFor(s.area, s.cmpB);
  return !!a && !!b && a.track !== b.track;
}

function syncSides(): void {
  const s = S.get();
  const [da, db] = sideDates(s);
  // In "Water vs plants" mode the left side shows HH and the right side HV for the same pass; context layers stay as set.
  const pol = (id: string): S.State['layers'] => {
    const out = { ...s.layers };
    for (const l of layersFor(s.area)) if (l.group !== 'group.context' && !l.base) out[l.id] = { ...out[l.id], on: l.id === id };
    return out;
  };
  const extraA = s.compare === 'pol' ? { layers: pol('ked_hh') } : {};
  const extraB = s.compare === 'pol' ? { layers: pol('ked_hv') } : {};
  if (mapA?.getStyle()) syncRasters(mapA, ctxFrom(s, { date: da, ...extraA }));
  if (mapB?.getStyle()) syncRasters(mapB, ctxFrom(s, { date: db, ...extraB }));
}

function dateSelect(id: string, label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const s = S.get();
  const sel = h('select', { id, class: 'select', 'aria-label': label, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) });
  const byTrack = new Map<string, Pass[]>();
  for (const p of primaryPasses(s.area)) byTrack.set(p.track, [...(byTrack.get(p.track) ?? []), p]);
  for (const [track, list] of byTrack) {
    const og = h('optgroup', { label: `${t('compare.track', { track })} ${list[0].direction === 'A' ? '▲' : '▼'}` });
    for (const p of list) og.append(h('option', { value: p.date_myt, selected: p.date_myt === value }, `${fmtDate(p.date_myt)} ${p.time_myt}`));
    sel.append(og);
  }
  return h('label', { class: 'field' }, h('span', { class: 'hud-label' }, label), sel);
}

function toolbar(): HTMLElement {
  const s = S.get();
  const bar = h('div', { class: 'cmp-toolbar card' });
  if (s.area === 'kedah') {
    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('compare.mode') });
    for (const m of ['dates', 'pol'] as const) {
      seg.append(
        h(
          'button',
          { class: 'pill', 'aria-pressed': String(s.compare === m), onclick: () => S.set({ compare: m }) },
          t(m === 'dates' ? 'ked.pol.toggle.dates' : 'ked.pol.toggle.pol'),
        ),
      );
    }
    bar.append(seg);
  }
  if (s.compare === 'dates') {
    bar.append(
      dateSelect('cmp-a', t('compare.left'), s.cmpA, (v) => S.set({ cmpA: v })),
      dateSelect('cmp-b', t('compare.right'), s.cmpB, (v) => S.set({ cmpB: v })),
    );
    bar.append(h('p', { class: isRough(s) ? 'badge badge-rough' : 'badge' }, isRough(s) ? t('compare.rough') : t('compare.fair')));
  } else {
    bar.append(h('p', { class: 'cmp-note' }, t('ked.pol.define')), h('p', { class: 'cmp-note muted' }, t('ked.pol.scale')));
  }
  bar.append(
    h('div', { class: 'cmp-actions' },
      h('button', { class: 'pill', onclick: toggleSides }, t(s.compare === 'pol' ? 'compare.toggle.pol' : 'compare.toggle')),
      h('button', { class: 'pill pill-quiet', onclick: () => S.set({ compare: 'off' }) }, t('compare.close')),
    ),
  );
  return bar;
}

function sideLabel(which: 'a' | 'b'): HTMLElement {
  const s = S.get();
  if (s.compare === 'pol') {
    const simple = s.mode === 'simple';
    const key = which === 'a' ? (simple ? 'ked.pol.left.simple' : 'ked.pol.left') : simple ? 'ked.pol.right.simple' : 'ked.pol.right';
    return h('div', { class: `cmp-label cmp-label-${which}` }, h('strong', {}, t(key)), h('span', {}, fmtDate(s.date)));
  }
  const d = which === 'a' ? s.cmpA : s.cmpB;
  const word = d <= (which === 'a' ? s.cmpB : s.cmpA) ? t('compare.before') : t('compare.after');
  return h('div', { class: `cmp-label cmp-label-${which}` }, h('strong', {}, fmtDate(d)), h('span', {}, word));
}

function renderChrome(): void {
  const root = $('#compare');
  root.querySelector('.cmp-toolbar')?.remove();
  root.querySelectorAll('.cmp-label').forEach((n) => n.remove());
  root.prepend(toolbar());
  root.append(sideLabel('a'), sideLabel('b'));
}

function toggleSides(): void {
  if (!cmp || !mapB) return;
  const w = mapB.getContainer().getBoundingClientRect().width;
  cmp.setSlider(cmp.currentPosition > w / 2 ? Math.round(w * 0.04) : Math.round(w * 0.96));
}

function open(): void {
  const s = S.get();
  const key = `${s.area}|${s.theme}`;
  const root = $('#compare');
  if (mapA && openKey === key) {
    renderChrome();
    syncSides();
    return;
  }
  close(true);
  openKey = key;
  root.hidden = false;
  clear(root);
  const wrap = h('div', { class: 'cmp-wrap' });
  const elA = h('div', { class: 'cmp-map', id: 'cmp-map-a' });
  const elB = h('div', { class: 'cmp-map', id: 'cmp-map-b' });
  wrap.append(elA, elB);
  root.append(wrap);
  renderChrome();
  const cam = { center: map.getCenter(), zoom: map.getZoom() };
  const style = basemapStyle(s.theme);
  try {
    mapA = new MLMap({ container: elA, style, ...cam, attributionControl: false, maxZoom: 14 });
    mapB = new MLMap({ container: elB, style, ...cam, attributionControl: false, maxZoom: 14 });
  } catch (e) {
    root.append(h('p', { class: 'map-error' }, t('err.webgl')));
    console.error(e);
    return;
  }
  mapB.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  let ready = 0;
  const onLoad = () => {
    syncSides();
    if (++ready === 2 && !cmp && mapA && mapB) {
      try {
        cmp = new Compare(mapA, mapB, wrap, { orientation: 'vertical' });
      } catch (err) {
        root.append(h('p', { class: 'badge badge-rough' }, t('compare.error', { msg: String((err as Error).message) })));
      }
    }
  };
  mapA.on('style.load', onLoad);
  mapB.on('style.load', onLoad);
  for (const m of [mapA, mapB]) m.on('error', () => undefined);
}

function close(keepHidden = false): void {
  const root = document.getElementById('compare');
  if (mapB && !keepHidden) map.jumpTo({ center: mapB.getCenter(), zoom: mapB.getZoom() });
  cmp?.remove();
  cmp = null;
  mapA?.remove();
  mapB?.remove();
  mapA = mapB = null;
  openKey = '';
  if (root && !keepHidden) {
    root.hidden = true;
    clear(root);
  }
}

function refresh(): void {
  renderChrome();
  syncSides();
}

export function compareDefault(): Partial<S.State> {
  const a = area(S.get().area);
  return { compare: 'dates', cmpA: a.compare_default?.[0] ?? a.default_date, cmpB: a.compare_default?.[1] ?? a.default_date };
}
