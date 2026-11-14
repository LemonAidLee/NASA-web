// Focus areas + AI-analysis dashboard (expandable, closable).
// The analysis text is an AI draft from sourced facts, clearly tagged; radar numbers come from stats.json (pipeline).
// Refined version (reports/AI integration in SAR prototype.md): AI writes text at build time, code fills every number
// from the pipeline outputs, a person reviews it. No runtime model, no AI numbers, no safety advice.
// Panel options (12 Nov): A inspect card on marker hover, B inspect screen when expanded, C segmented stat bars.
import { Marker } from 'maplibre-gl';
import { area, daysBetween, diffDays, fmtDate, fmtDay, fmtNum, focusById, focusFor, focusMeta, methodsFor, primaryPasses, type FocusArea, type SourcedLine } from '../config';
import { t } from '../i18n';
import { $, clear, h } from '../lib/dom';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { districtByCode } from '../map/districts';
import { fitPadding, map, reduced } from '../map/mainMap';
import { districtSvg, inspectCard, segBar, statRow, visited } from './kit';
import { kedPass, kelPass, stats } from '../lib/stats';

const launcher = h('nav', { class: 'focus-launcher', 'aria-label': t('focus.launcher') });
const dash = h('section', { class: 'dash card', id: 'dash', 'aria-labelledby': 'dash-title', hidden: true });
let markers: { id: string; marker: Marker; el: HTMLElement }[] = [];

export function openFocus(id: string, fly = true): void {
  const s = S.get();
  visited.add('focus', id);
  S.set({ focus: id, dash: s.dash === 'max' ? 'max' : 'open', compare: 'off' });
  if (fly) zoomTo(id);
}

function zoomTo(id: string): void {
  const f = focusById(id);
  const d = f ? districtByCode(f.code) : undefined;
  if (!d) return;
  const pad = fitPadding();
  // Keep the district clear of the docked dashboard (desktop) or the dashboard sheet (phone).
  const dashH = S.get().dash === 'open' ? dash.getBoundingClientRect().height || 320 : 0;
  map.fitBounds(d.bbox, { padding: { ...pad, bottom: pad.bottom + dashH }, duration: reduced() ? 0 : 1000, maxZoom: 11.5 });
}

function step(dir: 1 | -1): void {
  const s = S.get();
  const list = focusFor(s.area);
  const i = list.findIndex((f) => f.id === s.focus);
  const next = list[(i + dir + list.length) % list.length];
  if (next) openFocus(next.id);
}

// ---------- map markers (A: hover preview is a compact inspect card) ----------

function renderMarkers(pulse: boolean): void {
  for (const m of markers) m.marker.remove();
  markers = [];
  const s = S.get();
  if (s.step !== null) return;
  focusFor(s.area).forEach((f, i) => {
    const preview = inspectCard({ compact: true, name: f.district, typeLeft: t('insp.focus', { n: i + 1 }), lore: `${f.title}. ${f.tagline}.` });
    preview.classList.add('focus-tip');
    preview.setAttribute('aria-hidden', 'true');
    const el = h('button', {
      class: `focus-marker${pulse && !reduced() ? ' pulse' : ''}`, type: 'button',
      'aria-label': t('focus.marker', { n: i + 1, district: f.district, title: f.title }),
      onclick: (e: Event) => { e.stopPropagation(); openFocus(f.id); },
    }, h('span', { class: 'focus-num' }, String(i + 1)), preview);
    const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(f.center).addTo(map);
    markers.push({ id: f.id, marker, el });
  });
  markSelected();
}

function markSelected(): void {
  const s = S.get();
  for (const m of markers) m.el.classList.toggle('is-selected', s.dash !== 'closed' && s.focus === m.id);
}

// ---------- launcher (shown when the dashboard is closed) ----------

function renderLauncher(): void {
  const s = S.get();
  const list = focusFor(s.area);
  clear(launcher);
  launcher.hidden = !list.length || s.step !== null || s.compare !== 'off' || s.dash !== 'closed';
  if (launcher.hidden) return;
  launcher.append(
    h('span', { class: 'hud-label' }, t('focus.launcher')),
    h('span', { class: 'launcher-tag' }, t('focus.launcher.tag')),
    ...list.map((f, i) => h('button', {
      class: 'pill pill-sm focus-chip', title: `${f.district} · ${f.title}`, 'aria-label': t('focus.marker', { n: i + 1, district: f.district, title: f.title }),
      onclick: () => openFocus(f.id),
    }, h('span', { class: 'focus-chip-num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'focus-chip-name', 'aria-hidden': 'true' }, f.district))),
  );
}

// ---------- shared dashboard pieces ----------

function source(l: SourcedLine): HTMLElement {
  // Our own boundary calculations are "our measurement"; plan citations point back to the sourced plan section.
  const label = l.src.startsWith('scripts/') ? `${t('focus.measured')}: ${l.src}` : l.src.startsWith('plan ') ? `${t('focus.plan')}: ${l.src}` : l.src;
  return l.url ? h('a', { href: l.url, target: '_blank', rel: 'noopener', class: 'src' }, label) : h('span', { class: 'src' }, label);
}

/** The area's numbers: radar ones are "made at the event" (hatched); district area and coverage are measured from DOSM. */
interface Stat { label: string; value: number | null; max: number; shown: string; basis: string }
function statsFor(f: FocusArea, s: S.State): Stat[] {
  const date = fmtDay(s.date);
  const pend = t('seg.pending');
  const list = focusFor(s.area);
  const maxKm = Math.max(...list.map((x) => x.area_km2));
  let radar: Stat[];
  if (s.area === 'kelantan') {
    const p = kelPass(s.date);
    const r = p?.districts[f.code];
    const peak = Math.max(1, ...Object.values(stats?.kelantan.dates ?? {}).map((d) => d.districts[f.code]?.flood_ha ?? 0));
    radar = r && p
      ? [
          { label: t('focus.kpi.kel.ha', { date: fmtDay(p.date_myt) }), value: r.flood_ha, max: peak, shown: `${fmtNum(r.flood_ha)} ha`, basis: t('focus.basis.peak', { ha: fmtNum(peak) }) },
          { label: t('focus.kpi.kel.change'), value: r.change_ha === null ? null : Math.abs(r.change_ha), max: peak, shown: r.change_ha === null ? t('focus.kpi.firstpass') : `${r.change_ha >= 0 ? '+' : '−'}${fmtNum(Math.abs(r.change_ha))} ha`, basis: t('focus.basis.peak', { ha: fmtNum(peak) }) },
          { label: t('focus.kpi.conf'), value: { high: 3, medium: 2, low: 1, none: 0 }[r.confidence], max: 3, shown: t(`conf.${r.confidence}`), basis: t('focus.basis.conf') },
        ]
      : [
          { label: t('focus.kpi.kel.ha', { date }), value: null, max: 1, shown: '— ha', basis: pend },
          { label: t('focus.kpi.kel.change'), value: null, max: 1, shown: '—', basis: pend },
          { label: t('focus.kpi.conf'), value: null, max: 1, shown: '—', basis: pend },
        ];
  } else {
    const p = kedPass(s.date);
    const r = p?.districts[f.code];
    const ff = stats?.kedah.districts[f.code];
    const firstKey = ff ? (['11', '12', '13', '14'] as const).find((k) => (ff.first_flooded_ha[k] ?? 0) > 0) : undefined;
    const peakKey = ff ? (['11', '12', '13', '14'] as const).reduce((a, k) => ((ff.first_flooded_ha[k] ?? 0) > (ff.first_flooded_ha[a] ?? 0) ? k : a), '11') : undefined;
    const label: Record<string, string> = { '11': t('when.t1'), '12': t('when.t2'), '13': t('when.t3'), '14': t('when.t4') };
    radar = r && p
      ? [
          { label: t('focus.kpi.ked.pct', { date: fmtDay(p.date_myt) }), value: r.pct_field_water, max: 100, shown: `${r.pct_field_water}%`, basis: t('insp.basis.pct') },
          { label: t('focus.kpi.ked.first'), value: null, max: 1, shown: firstKey ? label[firstKey] : '—', basis: t('focus.basis.first') },
          { label: t('focus.kpi.ked.peak'), value: null, max: 1, shown: peakKey && ff && (ff.first_flooded_ha[peakKey] ?? 0) > 0 ? `${label[peakKey]} · ${fmtNum(ff.first_flooded_ha[peakKey])} ha` : '—', basis: t('focus.basis.first') },
        ]
      : [
          { label: t('focus.kpi.ked.pct', { date }), value: null, max: 1, shown: '—%', basis: pend },
          { label: t('focus.kpi.ked.first'), value: null, max: 1, shown: '—', basis: pend },
          { label: t('focus.kpi.ked.stage'), value: null, max: 1, shown: '—', basis: pend },
        ];
  }
  return [
    ...radar,
    { label: t('focus.kpi.area'), value: f.area_km2, max: maxKm, shown: `${fmtNum(f.area_km2)} km²`, basis: t('insp.basis.area', { area: t(area(s.area).short), km: fmtNum(maxKm) }) },
    { label: t('focus.kpi.inside'), value: f.inside_pct, max: 100, shown: `${f.inside_pct}%`, basis: t('insp.basis.pct') },
  ];
}

/** C: stat tiles with segmented bars (docked dashboard). Only the three radar results here (14 Nov declutter);
 *  district area and radar coverage stay in the expanded view's stats list. */
function kpis(f: FocusArea, s: S.State): HTMLElement {
  return h('div', { class: 'kpis kpis-3' }, statsFor(f, s).slice(0, 3).map((st) => {
    const pending = st.shown.startsWith('—');
    return h('div', { class: `kpi${pending ? ' is-pending' : ''}` },
      h('p', { class: 'kpi-label' }, st.label),
      h('p', { class: 'kpi-value num' }, st.shown),
      st.value !== null || pending ? segBar({ value: st.value, max: st.max, basis: st.basis }) : null,
      h('p', { class: 'kpi-note' }, pending ? t('focus.kpi.pending') : st.basis),
    );
  }));
}

function timeline(f: FocusArea, s: S.State): HTMLElement {
  const a = area(s.area);
  const [start, end] = a.strip ?? [s.date, s.date];
  const total = daysBetween(start, end).length;
  const pos = (d: string) => `${(Math.max(0, Math.min(total - 1, diffDays(d, start))) / (total - 1)) * 100}%`;
  const track = h('div', { class: 'tl-track' });
  for (const p of a.phases ?? []) {
    const e2 = p.end > end ? end : p.end;
    track.append(h('span', { class: 'tl-phase', style: `left:${pos(p.start)};width:calc(${pos(e2)} - ${pos(p.start)})`, title: t('time.cell.phase', { id: p.id }) }));
  }
  for (const p of primaryPasses(s.area)) {
    track.append(h('button', {
      class: `tl-bar${p.date_myt === s.date ? ' is-current' : ''}`, style: `left:${pos(p.date_myt)}`,
      'aria-label': `${fmtDate(p.date_myt)} ${p.time_myt} MYT, ${p.sensor} ${p.track}`, title: `${fmtDate(p.date_myt)} · ${p.track}`,
      onclick: () => S.set({ date: p.date_myt }),
    }, h('span', { class: 'tl-fill' })));
  }
  // Event labels step down one row each so close dates (MADA phases 10 days apart) never overlap.
  f.events.forEach((ev, row) => {
    track.append(h('span', { class: 'tl-event', style: `left:${pos(ev.date)};--row:${row}` }, h('span', { class: 'tl-event-label' }, `${fmtDay(ev.date)} · ${ev.label}`)));
  });
  track.append(h('span', { class: 'tl-now', style: `left:${pos(s.date)}`, 'aria-hidden': 'true' }));
  return h('div', { class: 'tl' }, track, h('div', { class: 'tl-ends' }, h('span', {}, fmtDay(start)), h('span', {}, fmtDay(end))));
}

function block(title: string, tag: string, ...body: (HTMLElement | string | null)[]): HTMLElement {
  return h('section', { class: 'dash-block' }, h('h3', { class: 'dash-h' }, title, h('span', { class: 'dash-tag' }, tag)), ...body.filter(Boolean) as HTMLElement[]);
}

/** B: methods as perk columns. Solid = runs on event day; dashed = refined version (AI parts). */
function perks(areaId: string): HTMLElement {
  const groups = methodsFor(areaId);
  return h('div', { class: 'perks' },
    h('div', { class: 'perk-cols', style: `--cols:${groups.length}` }, groups.map((g) =>
      h('div', { class: 'perk-col' },
        h('span', { class: 'hud-label' }, g.group),
        ...g.items.map((m) => h('span', {
          class: `sock perk${m.status === 'event' ? ' on' : ' pend'}`, tabindex: '0',
          'aria-label': `${m.name}. ${m.text} ${t(m.status === 'event' ? 'focus.method.event' : 'focus.method.planned')}.`,
        }, m.glyph, h('span', { class: 'perk-tip', 'aria-hidden': 'true' },
          h('strong', {}, m.name), h('span', {}, m.text), h('em', {}, t(m.status === 'event' ? 'focus.method.event' : 'focus.method.planned')))))))),
    h('p', { class: 'perk-legend' }, t('focus.methods.legend')),
  );
}

function actions(f: FocusArea): HTMLElement {
  return h('div', { class: 'dash-actions' },
    h('button', { class: 'pill pill-primary', onclick: () => zoomTo(f.id) }, t('focus.zoom', { district: f.district })),
    h('button', { class: 'pill', onclick: () => S.set({ ...compareDefault(), dash: 'closed' }) }, t('compare.open')),
    h('button', { class: 'pill', onclick: () => S.set({ district: f.code, tab: 'numbers', sheet: 'half' }) }, t('focus.numbers')),
    h('button', { class: 'pill pill-quiet', onclick: openSureFromDash }, t('sure.pill')),
  );
}

// ---------- B: inspect screen (expanded) ----------

function inspectScreen(f: FocusArea, s: S.State, i: number): HTMLElement {
  const d = districtByCode(f.code);
  const svg = districtSvg(f.code, 'silhouette-svg');
  return h('div', { class: 'dash-body dash-body-max' },
    h('div', { class: 'insp-screen' },
      h('div', { class: 'insp-left' },
        h('p', { class: 'insp-kind hud-label' }, `${t('insp.type.district', { state: d?.state ?? '' })} · ${t('insp.focus', { n: i + 1 })}`),
        h('h3', { class: 'insp-big' }, f.district),
        h('p', { class: 'insp-subtitle' }, f.title),
        h('div', { class: 'insp-rule' }),
        h('p', { class: 'insp-lore' }, f.ai_draft),
        h('p', { class: 'dash-rule' }, t('focus.rule')),
        h('h4', { class: 'dash-h' }, t('focus.facts'), h('span', { class: 'dash-tag' }, t('focus.facts.tag'))),
        h('ul', { class: 'dash-list' }, f.facts.map((l) => h('li', {}, l.text, ' ', source(l)))),
      ),
      h('figure', { class: 'insp-center' },
        h('span', { class: 'ring r1' }), h('span', { class: 'ring r2' }), h('span', { class: 'ring r3' }),
        svg,
        h('figcaption', { class: 'hud-label' }, t('focus.boundary')),
      ),
      h('div', { class: 'insp-right' },
        h('h4', { class: 'dash-h' }, t('focus.stats')),
        h('div', { class: 'insp-stats' }, statsFor(f, s).map((st) => statRow(st.label, segBar({ value: st.value, max: st.max, basis: st.basis }), st.shown))),
        h('h4', { class: 'dash-h' }, t('focus.methods')),
        perks(s.area),
      ),
    ),
    h('div', { class: 'dash-grid' },
      block(t('focus.timeline'), t('focus.timeline.tag'), timeline(f, s)),
      block(t('focus.drivers'), t('focus.drivers.tag'), h('ul', { class: 'dash-list' }, f.drivers.map((l) => h('li', {}, l.text, ' ', source(l))))),
      block(t('focus.ai'), t('focus.ai.tag'), h('p', {}, f.ai_focus), h('p', { class: 'dash-lookcloser' }, t('focus.lookcloser.body'))),
    ),
    actions(f),
  );
}

// ---------- docked dashboard ----------

function dockedBody(f: FocusArea, s: S.State): HTMLElement {
  return h('div', { class: 'dash-body' },
    kpis(f, s),
    h('div', { class: 'dash-grid' },
      // Calmer docked view (14 Nov): the AI analysis and its suggestion first; causes and methods live in the
      // expanded view (⤢), so the docked panel is not a wall of text.
      block(t('focus.what'), t('focus.what.tag'), h('p', { class: 'dash-summary' }, f.ai_draft), h('p', { class: 'dash-rule' }, t('focus.rule'))),
      block(t('focus.ai'), t('focus.ai.tag'), h('p', {}, f.ai_focus), h('p', { class: 'dash-lookcloser' }, t('focus.lookcloser.body'))),
      block(t('focus.timeline'), t('focus.timeline.tag'), timeline(f, s)),
      block(t('focus.facts'), t('focus.facts.tag'), h('ul', { class: 'dash-list' }, f.facts.map((l) => h('li', {}, l.text, ' ', source(l))))),
    ),
    actions(f),
  );
}

function renderDash(): void {
  const s = S.get();
  const f = focusById(s.focus);
  const visible = !!f && s.dash !== 'closed' && s.step === null && s.compare === 'off' && focusFor(s.area).some((x) => x.id === f.id);
  dash.hidden = !visible;
  document.documentElement.dataset.dash = visible ? s.dash : 'closed';
  if (!visible || !f) return;
  const list = focusFor(s.area);
  const i = list.findIndex((x) => x.id === f.id);
  clear(dash);
  dash.append(
    h('header', { class: 'dash-head' },
      h('div', { class: 'dash-title-wrap' },
        h('div', { class: 'dash-path-row' },
          h('p', { class: 'hud-label' }, `${t('focus.label')} · ${t('focus.of', { n: i + 1, total: list.length })}`),
          // Focus areas as a node path (skill-tree style); each node opens that area.
          h('ol', { class: 'node-path node-path-sm', 'aria-label': t('focus.launcher') }, list.map((x, k) =>
            h('li', { class: k === i ? 'is-current' : '' },
              h('button', { class: 'node', 'aria-label': t('focus.marker', { n: k + 1, district: x.district, title: x.title }), title: x.district, 'aria-current': k === i ? 'true' : null, onclick: () => openFocus(x.id) },
                h('span', { class: 'node-num', 'aria-hidden': 'true' }, String(k + 1))))))),
        s.dash === 'max'
          ? h('h2', { class: 'sr-only', id: 'dash-title' }, `${f.district} · ${f.title}`)
          : h('h2', { class: 'dash-title', id: 'dash-title' }, f.district, h('span', { class: 'dash-sub' }, ` · ${f.title}`)),
        s.dash === 'max' ? null : h('p', { class: 'card-tagline' }, f.tagline),
      ),
      h('div', { class: 'dash-tags' },
        h('span', { class: 'chip chip-ai' }, focusMeta.reviewed ? t('focus.label') : t('focus.tag.draft')),
        h('span', { class: 'chip' }, t('focus.tag.pending')),
      ),
      h('div', { class: 'dash-controls' },
        h('button', { class: 'pill pill-sm', 'aria-label': t('focus.prev'), onclick: () => step(-1) }, '◀'),
        h('button', { class: 'pill pill-sm', 'aria-label': t('focus.next'), onclick: () => step(1) }, '▶'),
        h('button', {
          class: 'pill pill-sm', 'aria-label': t(s.dash === 'max' ? 'focus.shrink' : 'focus.expand'), title: t(s.dash === 'max' ? 'focus.shrink' : 'focus.expand'),
          'aria-expanded': String(s.dash === 'max'), onclick: () => S.set({ dash: S.get().dash === 'max' ? 'open' : 'max' }),
        }, s.dash === 'max' ? '⤡' : '⤢'),
        h('button', { class: 'pill pill-sm', 'aria-label': t('focus.close'), title: t('focus.close'), onclick: closeDash }, '✕'),
      ),
    ),
    s.dash === 'max' ? inspectScreen(f, s, i) : dockedBody(f, s),
  );
}

function openSureFromDash(): void {
  S.set({ tab: 'sure', sheet: 'half', sureOpen: true });
}

export function closeDash(): void {
  S.set({ dash: 'closed' });
  launcher.querySelector('button')?.focus();
}

export function dashOpen(): boolean {
  return S.get().dash !== 'closed';
}

export function initFocus(): void {
  const stage = $('#stage');
  stage.append(launcher, dash);
  renderLauncher();
  renderDash();
  map.once('load', () => renderMarkers(true));
  S.subscribe((s, ch) => {
    if (ch.has('area')) {
      const keep = focusFor(s.area).some((f) => f.id === s.focus);
      if (!keep && (s.focus || s.dash !== 'closed')) {
        S.set({ focus: null, dash: 'closed' });
        return;
      }
    }
    if (ch.has('area') || ch.has('step')) renderMarkers(ch.has('area'));
    if (['focus', 'dash'].some((k) => ch.has(k as keyof S.State))) markSelected();
    if (['area', 'step', 'compare', 'dash', 'focus'].some((k) => ch.has(k as keyof S.State))) renderLauncher();
    if (['area', 'step', 'compare', 'dash', 'focus', 'date', 'mode'].some((k) => ch.has(k as keyof S.State))) renderDash();
  });
  const f0 = S.get().focus;
  if (f0 && S.get().dash !== 'closed') {
    visited.add('focus', f0);
    map.once('load', () => zoomTo(f0));
  }
}
