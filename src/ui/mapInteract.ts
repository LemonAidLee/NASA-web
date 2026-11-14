// F5 pixel popup (plain sentence first, numbers under "More") and F21 cursor readout bar.
import { Popup, type MapMouseEvent } from 'maplibre-gl';
import { area, imageryOnly, fmtDate, fmtNum, focusFor, layer, layersFor, resolveDate, type Area } from '../config';
import { classAt, dbAt } from '../lib/pixels';
import { stats } from '../lib/stats';
import { inspectCard, keyHint, segBar, statRow } from './kit';
import { openFocus } from './focus';
import { t } from '../i18n';
import { $, clear, h, storage } from '../lib/dom';
import * as S from '../state';
import { districtAt } from '../map/districts';
import { map, visibleLayers } from '../map/mainMap';

let popup: Popup | null = null;
export const sheetPopup = h('div', { class: 'sheet-popup', hidden: true });
let isMobile = () => window.matchMedia('(max-width: 767px)').matches;

const fmtCoord = (lat: number, lng: number) => `${lat.toFixed(4)}°N ${lng.toFixed(4)}°E`;

function inBox(lng: number, lat: number, b: [number, number, number, number]): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Same rule as the dotted outline: inside one of the area's study districts (else fall back to the radar box). */
function inStudy(a: Area, lng: number, lat: number, district?: string): boolean {
  if (a.study_districts?.length) return !!district && a.study_districts.includes(district);
  return inBox(lng, lat, a.bbox);
}

interface Reading {
  sentence: string;
  why: string;
}

const FIRST_LABEL: Record<number, string> = { 11: '23–25 Sep', 12: '5–7 Oct', 13: '17–19 Oct', 14: '31 Oct' };
const db1 = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} dB`);

/** What our baked maps hold at this spot, in plain words (null when the pipeline has not made them). */
async function ourReading(a: Area, date: string, lng: number, lat: number): Promise<Reading | null> {
  try {
    if (a.id === 'kelantan') {
      const fl = layer('kel_flood');
      const vvL = layer('kel_vv');
      if (!fl || fl.kind !== 'image') return null;
      const r = resolveDate(fl, 'kelantan', date);
      if (!r) return null;
      const [code, vv] = await Promise.all([classAt(fl, r.utc, lng, lat), vvL ? dbAt(vvL, r.utc, lng, lat) : Promise.resolve(null)]);
      const th = stats?.kelantan.dates[r.utc]?.threshold_db;
      const key = code === 3 ? 'kel.popup.flood' : code === 4 ? 'kel.popup.possible' : code === 2 ? 'kel.popup.permanent'
        : code === 5 ? 'kel.popup.urban' : code === 6 ? 'kel.popup.cantsee' : 'kel.popup.dry';
      return { sentence: t(key, { date: fmtDate(r.myt) }), why: t('popup.why.kel.real', { vv: db1(vv), t: th ?? '—', date: fmtDate(r.myt) }) };
    }
    if (a.id === 'kedah') {
      const ff = layer('ked_first_flooded');
      const hhL = layer('ked_hh');
      const hvL = layer('ked_hv');
      if (!ff || ff.kind !== 'image' || !hhL || !hvL) return null;
      const r = resolveDate(hhL, 'kedah', date);
      const [code, hh, hv] = await Promise.all([
        classAt(ff, 'static', lng, lat),
        r ? dbAt(hhL, r.utc, lng, lat) : Promise.resolve(null),
        r ? dbAt(hvL, r.utc, lng, lat) : Promise.resolve(null),
      ]);
      const track = r ? stats?.kedah.dates[r.utc]?.track : undefined;
      const st = track ? stats?.kedah.stacks[track] : undefined;
      const wet = hh !== null && hv !== null && st ? hh < st.HH.threshold_db && hv < st.HV.threshold_db : null;
      const first = code !== null && FIRST_LABEL[code] ? t('ked.popup.first', { when: FIRST_LABEL[code] }) : code === 1 ? t('ked.popup.notyet') : code === 2 ? t('ked.popup.permanent') : t('ked.popup.notcrop');
      const now = r && wet !== null && code !== null && code !== 2 ? ` ${t(wet ? 'ked.popup.now.wet' : 'ked.popup.now.dry', { date: fmtDate(r.myt) })}` : '';
      return {
        sentence: `${first}${now}`,
        why: t('popup.why.ked.real', { hh: db1(hh), hv: db1(hv), thh: st?.HH.threshold_db ?? '—', thv: st?.HV.threshold_db ?? '—' }),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function popupContent(lng: number, lat: number, reading: Reading | null = null): HTMLElement {
  const s = S.get();
  const a = area(s.area);
  const d = districtAt(lng, lat);
  const vis = visibleLayers(s);
  const previews = vis.filter((l) => l.status === 'real' && l.kind === 'gibs').map((l) => t(l.name));
  let sentence: string;
  if (imageryOnly(a)) sentence = t('popup.imagery');
  else if (!inStudy(a, lng, lat, d?.district)) sentence = t('popup.outside', { area: t(a.short) });
  else if (reading) sentence = reading.sentence;
  else sentence = t(s.area === 'kelantan' ? 'popup.pending.kel' : 'popup.pending.ked', { date: fmtDate(s.date) });
  const expert = s.mode === 'expert';
  const more = h('div', { class: 'popup-more', hidden: !expert },
    h('dl', {},
      h('div', { class: 'kv' }, h('dt', {}, t('popup.coords')), h('dd', { class: 'num' }, fmtCoord(lat, lng))),
      d ? h('div', { class: 'kv' }, h('dt', {}, t('popup.district')), h('dd', {}, h('button', { class: 'link', onclick: () => S.set({ district: d.code, tab: 'numbers', sheet: 'half' }) }, d.district))) : null,
    ),
    !imageryOnly(a) ? h('p', { class: 'small' }, h('span', { class: 'hud-label' }, t('popup.why')), ' ', reading ? reading.why : t(s.area === 'kelantan' ? 'popup.why.kel' : 'popup.why.ked')) : null,
  );
  const moreBtn = h('button', { class: 'link', 'aria-expanded': String(expert) }, t(expert ? 'popup.less' : 'popup.more'));
  moreBtn.addEventListener('click', () => {
    more.hidden = !more.hidden;
    moreBtn.setAttribute('aria-expanded', String(!more.hidden));
    moreBtn.textContent = t(more.hidden ? 'popup.more' : 'popup.less');
  });

  // A · inspect card. Stats only where a number exists or is clearly marked as made at the event (C · segBar).
  const focusList = focusFor(s.area);
  const fi = d ? focusList.findIndex((f) => f.code === d.code) : -1;
  const f = fi >= 0 ? focusList[fi] : undefined;
  const pendingRadar = vis.some((l) => l.status === 'placeholder' && (l.kind === 'class' || l.kind === 'db'));
  const stats: HTMLElement[] = [];
  if (!imageryOnly(a)) {
    stats.push(statRow(t('insp.stat.radar'), segBar({ value: null, max: 1, basis: reading ? t('insp.basis.reading') : t('seg.pending') }), reading ? reading.why.split(' · ')[0] : pendingRadar ? '—' : t('hud.radar.preview')));
  }
  if (f) {
    const maxKm = Math.max(...focusList.map((x) => x.area_km2));
    stats.push(statRow(t('insp.stat.area'), segBar({ value: f.area_km2, max: maxKm, basis: t('insp.basis.area', { area: t(a.short), km: fmtNum(maxKm) }) }), `${fmtNum(f.area_km2)} km²`));
    stats.push(statRow(t('insp.stat.inside'), segBar({ value: f.inside_pct, max: 100, basis: t('insp.basis.pct') }), `${f.inside_pct}%`));
  }
  const actions: HTMLElement[] = [];
  if (f) actions.push(h('button', { class: 'pill pill-sm pill-primary', onclick: () => { closePopups(); openFocus(f.id); } }, t('insp.open')));
  if (s.area === 'kelantan') actions.push(h('button', { class: 'badge badge-link', onclick: () => S.set({ tab: 'sure', sheet: 'half', sureOpen: true }) }, t('num.badge')));
  actions.push(keyHint('Esc', t('insp.close')));
  const sockets = vis.filter((l) => l.abbr && l.kind !== 'vector').map((l) => ({ abbr: l.abbr as string, name: t(l.name), on: true, pending: l.status === 'placeholder' }));
  return inspectCard({
    name: d ? d.district : imageryOnly(a) ? t('insp.location') : t('insp.outside'),
    typeLeft: d ? t('insp.type.district', { state: d.state }) : fmtCoord(lat, lng),
    typeRight: f ? t('insp.focus', { n: fi + 1 }) : undefined,
    lore: sentence,
    stats,
    sockets,
    more: h('div', { class: 'insp-more' },
      previews.length && !imageryOnly(a) ? h('p', { class: 'small muted' }, t('popup.preview', { layers: previews.join(', ') })) : null,
      moreBtn, more),
    actions,
  });
}

async function onClick(e: MapMouseEvent): Promise<void> {
  dismissHint();
  const { lng, lat } = e.lngLat;
  const s0 = S.get();
  const a0 = area(s0.area);
  const reading = imageryOnly(a0) ? null : await ourReading(a0, s0.date, lng, lat);
  if (S.get().area !== s0.area || S.get().date !== s0.date) return; // the view changed while reading
  const content = popupContent(lng, lat, reading);
  if (isMobile()) {
    popup?.remove();
    clear(sheetPopup);
    sheetPopup.append(content, h('button', { class: 'pill pill-quiet', onclick: closeSheetPopup }, t('popup.close')));
    sheetPopup.hidden = false;
    if (S.get().sheet === 'peek') S.set({ sheet: 'half' });
    return;
  }
  popup?.remove();
  popup = new Popup({ maxWidth: '340px', className: 'app-popup insp-popup', focusAfterOpen: false }).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
}

export function closePopups(): void {
  popup?.remove();
  popup = null;
  closeSheetPopup();
}

function closeSheetPopup(): void {
  sheetPopup.hidden = true;
  clear(sheetPopup);
}

// ---------- hint (plan 07 F8 onboarding: one hint, once) ----------

export function showHintOnce(): void {
  if (storage.get('hint-seen')) return;
  const el = $('#hint');
  clear(el);
  el.append(h('p', {}, t('hint.tap')), h('button', { class: 'pill pill-sm', onclick: dismissHint }, t('hint.dismiss')));
  el.hidden = false;
}

function dismissHint(): void {
  const el = document.getElementById('hint');
  if (el && !el.hidden) {
    el.hidden = true;
    storage.set('hint-seen', '1');
  }
}

// ---------- F21 cursor bar ----------

let last = 0;
let lastXY: [number, number] | null = null;

function renderCursor(lng?: number, lat?: number): void {
  const bar = $('#cursorbar');
  const s = S.get();
  const a = area(s.area);
  const d = lng !== undefined && lat !== undefined ? districtAt(lng, lat) : null;
  const vis = visibleLayers(s);
  const hasPending = vis.some((l) => l.status === 'placeholder' && (l.kind === 'class' || l.kind === 'db'));
  const radar = imageryOnly(a) ? t('hud.radar.preview') : hasPending ? t('hud.radar.pending') : t('hud.radar.preview');
  const seg = (label: string, value: string) => h('span', { class: 'hud-seg' }, h('span', { class: 'hud-label' }, label), ' ', h('span', { class: 'hud-value' }, value));
  clear(bar);
  bar.append(
    h('div', { class: 'hud-row x-only' },
      seg(t('hud.cursor'), lng !== undefined && lat !== undefined ? fmtCoord(lat, lng) : t('hud.none')),
      seg(t('hud.district'), d ? d.district.toUpperCase() : t('hud.none')),
      seg(t('hud.radar'), radar),
      seg(t('hud.zoom'), map.getZoom().toFixed(1)),
    ),
    h('div', { class: 'hud-row s-only' },
      h('span', { class: 'small' }, d ? `${d.district} · ` : '', lng !== undefined ? t(imageryOnly(a) ? 'popup.imagery' : 'hint.tap') : t('hint.tap')),
    ),
  );
}

export function initMapInteract(): void {
  map.on('click', (e) => void onClick(e));
  map.on('mousemove', (e) => {
    const now = performance.now();
    lastXY = [e.lngLat.lng, e.lngLat.lat];
    if (now - last < 60) return;
    last = now;
    renderCursor(lastXY[0], lastXY[1]);
  });
  map.on('zoomend', () => renderCursor(lastXY?.[0], lastXY?.[1]));
  S.subscribe((_s, ch) => {
    if (ch.has('area') || ch.has('date')) closePopups();
    if (['area', 'layers', 'mode', 'base'].some((k) => ch.has(k as keyof S.State))) renderCursor(lastXY?.[0], lastXY?.[1]);
  });
  renderCursor();
  void layersFor;
  isMobile = () => window.matchMedia('(max-width: 767px)').matches;
}
