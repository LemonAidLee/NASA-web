// Right panel (desktop) / bottom-sheet tabs (mobile): Numbers (F7, F14), Rain (F13), How sure are we? (F9), Story, About + credits (F10).
import { area, layer, imageryOnly, daysBetween, diffDays, fmtDate, fmtDay, fmtNum, primaryPasses, provenance, story } from '../config';
import { t } from '../i18n';
import { card, clear, h } from '../lib/dom';
import * as S from '../state';
import { districtByCode, districtsOf } from '../map/districts';
import { map } from '../map/mainMap';
import { legendCard, layersCard, titleCard } from './leftCol';
import { segBar, statRow } from './kit';
import { earthdataSearchUrl, latestTime, vertexUrl, type Bbox } from '../lib/catalog';
import { ha as haFmt, haRange, kedDateByUtc, kedPass, kelPass, rain as rainData, stats } from '../lib/stats';
import { columnChart, dailyChart, distChart, num, rankChart, timeChart } from './charts';
import { deskTabs, minimiseButton } from './rails';

export const panelRoot = h('div', { class: 'panel-inner' });
let mobile = false;

export function setPanelMobile(m: boolean): void {
  mobile = m;
  render();
}

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

function tabs(s: S.State): Tab[] {
  const a = area(s.area);
  const expert = s.mode === 'expert' && !mobile;
  const numbersLabel = imageryOnly(a) ? t(a.kind === 'live' ? 'tab.numbers.live' : 'tab.numbers.exp') : t(expert ? (a.panel.numbers_tab_expert ?? 'tab.numbers') : mobile ? 'tab.numbers' : (a.panel.numbers_tab ?? 'tab.numbers'));
  const sureCount = String(a.panel.sure_lines.length);
  if (mobile) {
    return [
      { id: 'layers', label: t('tab.layers') },
      { id: 'numbers', label: numbersLabel },
      { id: 'story', label: t('tab.story') },
      { id: 'about', label: t('tab.about') },
    ];
  }
  if (!mobile) {
    // Desktop: the right rail picks the section (ui/rails.ts); the same list drives Q / E and the panel header.
    return deskTabs(s).map((id) => ({ id, label: sectionLabel(s, id) }));
  }
  if (expert) {
    const list: Tab[] = [
      { id: 'numbers', label: numbersLabel.toUpperCase(), badge: s.area === 'kedah' ? String(primaryPasses('kedah').length) : s.area === 'kelantan' ? '—' : undefined },
    ];
    if (!imageryOnly(a)) list.push({ id: 'rain', label: t('tab.rain').toUpperCase() });
    list.push(
      { id: 'sure', label: t('tab.sure').toUpperCase(), badge: sureCount },
      { id: 'story', label: t('tab.story').toUpperCase(), badge: String(story.steps.length) },
      { id: 'about', label: t('tab.about').toUpperCase() },
    );
    return list;
  }
  return [
    { id: 'numbers', label: numbersLabel },
    { id: 'story', label: t('tab.story') },
    { id: 'sure', label: t('sure.pill') },
    { id: 'about', label: t('tab.about') },
  ];
}

function sectionLabel(s: S.State, id: string): string {
  const a = area(s.area);
  if (id === 'numbers') return t(a.kind === 'live' ? 'rail.numbers.live' : imageryOnly(a) ? 'rail.numbers.exp' : 'rail.numbers');
  return t(`rail.${id}`);
}

function activeTab(s: S.State, list: Tab[]): string {
  let id = s.tab;
  if (mobile && id === 'sure') id = 'about';
  if (!mobile && id === 'layers') id = 'numbers';
  return list.some((x) => x.id === id) ? id : list[0].id;
}

// ---------------- Numbers ----------------

const src = (label: string, url: string) => h('a', { href: url, target: '_blank', rel: 'noopener' }, label);

function badge(): HTMLElement {
  return h('button', { class: 'badge badge-link', onclick: () => S.set({ tab: 'sure', sheet: 'half' }) }, t('num.badge'));
}

function pendingNote(): HTMLElement {
  return h('p', { class: 'pending' }, h('strong', {}, t('num.pending')), ' ', t('num.pending.long'));
}

function selectDistrict(code: string): void {
  S.set({ district: code });
  const d = districtByCode(code);
  if (d) map.fitBounds(d.bbox, { padding: 60, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
}

const signed = (n: number | null): string => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n))} ha`);

function districtCard(s: S.State): HTMLElement | null {
  if (!s.district) return null;
  const d = districtByCode(s.district);
  if (!d) return null;
  const row = (k: string, v: string) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', { class: 'num' }, v));
  const kel = s.area === 'kelantan';
  const kp = kel ? kelPass(s.date) : null;
  const kr = kp?.districts[s.district];
  const dp = kel ? null : kedPass(s.date);
  const dr = dp?.districts[s.district];
  return h('section', { class: 'card district-card', 'aria-live': 'polite' },
    h('h2', { class: 'card-title' }, t('district.card.title', { district: d.district })),
    h('p', { class: 'card-tagline' }, t('district.card.tagline', { state: d.state })),
    h('dl', {},
      kel ? row(t('num.ha'), kr ? `${haFmt(kr.flood_ha)} (${haRange(kr.flood_ha_low, kr.flood_ha_high)})` : '— ha') : row(t('num.ked.pct'), dr ? `${dr.pct_field_water}%` : '—%'),
      kel ? row(t('num.change'), kr ? signed(kr.change_ha) : '—') : null,
      kel ? row(t('num.possible'), kr ? haFmt(kr.possible_ha) : '—') : row(t('num.ked.seen'), dr ? haFmt(dr.cropland_ha_seen) : '—'),
      kel ? row(t('num.conf'), kr ? t(`conf.${kr.confidence}`) : t('conf.pending')) : null,
    ),
    kp || dp ? h('p', { class: 'muted small' }, t(kel ? 'num.date.kel' : 'num.date.ked', { date: fmtDate((kp ?? dp)!.date_myt) })) : null,
    badge(),
    h('button', { class: 'pill pill-quiet', onclick: () => S.set({ district: null }) }, t('district.card.close')),
  );
}

function methodNote(text: string): HTMLElement {
  return h('p', { class: 'method-note small' }, text);
}

const FIRST_LABEL: Record<number, string> = { 11: t('when.t1'), 12: t('when.t2'), 13: t('when.t3'), 14: t('when.t4') };

/** New flood water in the study districts, per radar pass (one series, ±1 dB band); click a point to go to that pass. */
function kelTrend(s: S.State): HTMLElement | null {
  const a = area('kelantan');
  const dates = stats?.kelantan.dates;
  if (!dates || !a.strip) return null;
  const points = Object.values(dates).map((d) => ({ date: d.date_myt, y: d.flood_ha, lo: d.flood_ha_low, hi: d.flood_ha_high, key: d.date_myt }));
  return timeChart({
    title: t('num.kel.chart.title'), explain: t('num.kel.chart.explain'), subtitle: t('num.kel.chart.sub'), unit: 'ha',
    start: a.strip[0], end: a.strip[1],
    series: [{ name: t('num.kel.chart.series'), color: 'var(--viz-flood)', points }],
    current: s.date, onPick: (d) => S.set({ date: d }),
    note: t('num.kel.chart.note'),
  });
}

/** Ranked districts for the pass on screen (one hue, range whiskers); click a district to zoom to it. */
function kelRank(s: S.State): HTMLElement | null {
  const pass = kelPass(s.date);
  if (!pass || !pass.reference) return null;
  const rows = Object.entries(pass.districts)
    .filter(([, r]) => r.study)
    .map(([code, r]) => ({ label: r.district, value: r.flood_ha, lo: r.flood_ha_low, hi: r.flood_ha_high, key: code }));
  return rankChart({
    title: t('num.kel.rank.title', { date: fmtDay(pass.date_myt) }), explain: t('num.kel.rank.explain'), subtitle: t('num.kel.rank.sub'), note: t('num.kel.rank.note'),
    unit: 'ha', rows, color: 'var(--viz-flood)', selected: s.district, onPick: selectDistrict,
  });
}

/** Radar brightness histograms with the water threshold: shows the two humps (water, land) the threshold splits. */
function brightnessChart(s: S.State): HTMLElement | null {
  const hs = stats?.histograms;
  if (s.area === 'kelantan' && hs?.kelantan) {
    const k = hs.kelantan;
    const before = k.dates['2024-11-17'];
    const flood = k.dates['2024-11-29'];
    if (!before || !flood) return null;
    return distChart({
      title: t('sure.hist.kel.title'), explain: t('sure.hist.kel.explain'), subtitle: t('sure.hist.kel.sub'), xLabel: t('sure.hist.x', { band: k.band }),
      series: [
        { name: t('sure.hist.kel.before'), color: 'var(--viz-context)', ...before },
        { name: t('sure.hist.kel.flood'), color: 'var(--viz-flood)', emphasis: true, ...flood },
      ],
      threshold: { value: k.threshold_db, label: t('sure.hist.threshold', { t: num(k.threshold_db) }) },
      note: t('sure.hist.kel.note'),
    });
  }
  if (s.area === 'kedah' && hs?.kedah) {
    const k = hs.kedah;
    const early = k.dates.HH['2026-09-25'];
    const late = k.dates.HH['2026-10-31'];
    if (!early || !late) return null;
    return distChart({
      title: t('sure.hist.ked.title'), explain: t('sure.hist.ked.explain'), subtitle: t('sure.hist.ked.sub'), xLabel: t('sure.hist.x', { band: 'HH' }),
      series: [
        { name: t('sure.hist.ked.early'), color: 'var(--viz-context)', ...early },
        { name: t('sure.hist.ked.late'), color: 'var(--viz-s1)', emphasis: true, ...late },
      ],
      threshold: { value: k.threshold_db.HH, label: t('sure.hist.threshold', { t: num(k.threshold_db.HH) }) },
      note: t('sure.hist.ked.note', { hv: num(k.threshold_db.HV) }),
    });
  }
  return null;
}

/** People near the water and where it stayed (pipeline/12_impact.py). Uses the pass on screen, or the peak pass
 *  when the pass on screen is a "before" picture. */
function kelImpact(s: S.State): HTMLElement | null {
  const im = stats?.kelantan.impact;
  const dates = stats?.kelantan.dates;
  if (!im || !dates) return null;
  const onScreen = kelPass(s.date);
  const peak = Object.entries(dates).reduce((a, b) => (b[1].flood_ha > a[1].flood_ha ? b : a));
  const key = onScreen && onScreen.reference && im.dates[onScreen.utc]?.people_near ? onScreen.utc : peak[0];
  const p = im.dates[key];
  const myt = dates[key].date_myt;
  const rows = Object.entries(im.duration.districts)
    .filter(([, r]) => r.study)
    .map(([code, r]) => ({ label: r.district, value: r.ha_2 + r.ha_3, key: code }));
  const lasting = rows.reduce((a, r) => a + r.value, 0);
  const showLayer = () => S.setLayer('kel_duration', { on: true });
  return card(t('impact.title'), t('impact.tagline'),
    h('p', { class: 'headline-num' }, t('impact.people', { n: fmtNum(Math.round(p.people_near / 100) * 100), m: im.near_m, date: fmtDay(myt) })),
    h('p', { class: 'small' }, t('impact.people.in', { n: fmtNum(Math.round(p.people_in / 100) * 100) })),
    myt === '2024-11-29' ? h('p', { class: 'small muted' }, t('impact.people.compare')) : null,
    rankChart({
      title: t('impact.dur.title'), explain: t('impact.dur.explain', { days: im.pass_gap_days }), subtitle: t('impact.dur.sub', { ha: haFmt(lasting) }),
      unit: 'ha', rows, color: 'var(--viz-flood)', selected: s.district, onPick: selectDistrict, note: t('impact.dur.note'),
    }),
    h('button', { class: 'pill pill-sm', onclick: showLayer }, t('impact.dur.show')),
    methodNote(t('impact.method', { m: im.near_m, src: im.population })),
  );
}

function numbersKelantan(s: S.State): HTMLElement[] {
  const pass = kelPass(s.date);
  const rows = districtsOf(['Kelantan'])
    .map((r) => ({ ...r, v: pass?.districts[r.code] }))
    .sort((x, y) => (y.v?.flood_ha ?? -1) - (x.v?.flood_ha ?? -1));
  const table = h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, t('num.table.caption', { date: fmtDate(pass?.date_myt ?? s.date) })),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('num.district')), h('th', { scope: 'col' }, t('num.ha')), h('th', { scope: 'col', class: 'x-only' }, t('num.change')), h('th', { scope: 'col' }, t('num.conf')))),
    h('tbody', {}, rows.map((r) =>
      h('tr', { class: `${s.district === r.code ? 'is-selected' : ''}${r.v && !r.v.study ? ' is-outside' : ''}` },
        h('th', { scope: 'row' }, h('button', { class: 'link', onclick: () => selectDistrict(r.code) }, r.district)),
        h('td', { class: 'num', title: r.v ? haRange(r.v.flood_ha_low, r.v.flood_ha_high) : '' }, r.v ? haFmt(r.v.flood_ha) : '— ha'),
        h('td', { class: 'num x-only' }, r.v ? signed(r.v.change_ha) : '—'),
        h('td', {}, r.v ? t(`conf.${r.v.confidence}`) : t('conf.pending')),
      ))),
  );
  const top = pass?.top_district ? Object.values(pass.districts).find((d) => d.district === pass.top_district) : undefined;
  return [
    card(t('num.kel.title'), t('num.kel.tagline'),
      h('p', { class: 'headline-num' }, pass && top && top.flood_ha > 0
        ? t('num.kel.headline.real', { district: top.district, ha: haFmt(top.flood_ha), date: fmtDay(pass.date_myt) })
        : pass ? t('num.kel.headline.none', { date: fmtDay(pass.date_myt) }) : t('num.kel.headline', { district: 'Pasir Mas', date: fmtDay(s.date) })),
      pass ? h('p', { class: 'small' }, t('num.kel.total', { ha: haFmt(pass.flood_ha), range: haRange(pass.flood_ha_low, pass.flood_ha_high) })) : null,
      badge(),
      pass
        ? methodNote(pass.reference
          ? t('num.method.kel', { date: fmtDate(pass.date_myt), track: pass.track, ref: fmtDate(pass.reference), t: pass.threshold_db })
          : t('num.method.kel.ref', { date: fmtDate(pass.date_myt), track: pass.track }))
        : pendingNote(),
      kelTrend(s),
      kelRank(s),
      h('div', { class: 'table-wrap' }, table),
      pass ? h('p', { class: 'muted small' }, t('num.kel.outside')) : null,
    ),
    ...[kelImpact(s)].filter((x): x is HTMLElement => !!x),
    card(t('num.context.title'), t('num.context.tagline'),
      h('ul', { class: 'facts' },
        h('li', {}, t('num.context.4'), ' ', src(t('num.context.4.src'), 'https://thestartv.com/v/floods-in-kelantan-the-worst-in-history-says-state-police-chief')),
        h('li', {}, t('num.context.1'), ' ', src(t('num.context.1.src'), 'https://www.malaymail.com/news/malaysia/2024/11/29/worsening-floods-hit-eight-states-nearly-100000-displaced-as-kelantan-and-terengganu-endure-worst-impact/158425')),
        h('li', {}, t('num.context.2'), ' ', src(t('num.context.2.src'), 'https://thestar.com.my/news/nation/2024/12/01/floods-97128-victims-affected-in-kelantan-shows-no-signs-of-improvement')),
        h('li', {}, t('num.context.3'), ' ', src(t('num.context.3.src'), 'https://www.dosm.gov.my/portal-main/release-content/special-report-on-impact-of-floods-in-malaysia-2024')),
      ),
    ),
  ];
}

function phaseChart(s: S.State): HTMLElement {
  const a = area('kedah');
  const [start, end] = a.strip ?? ['2026-09-15', '2026-10-31'];
  const total = daysBetween(start, end).length;
  const pos = (d: string) => `${(Math.max(0, Math.min(total, diffDays(d, start))) / total) * 100}%`;
  const chart = h('div', { class: 'phase-chart', role: 'img', 'aria-label': t('num.ked.phases') });
  for (const p of a.phases ?? []) {
    const endClip = p.end > end ? end : p.end;
    chart.append(h('div', { class: 'phase-row' },
      h('span', { class: 'phase-name' }, t('phase.n', { id: p.id })),
      h('span', { class: 'phase-track' }, h('span', { class: 'phase-bar', style: `left:${pos(p.start)};width:calc(${pos(endClip)} - ${pos(p.start)})` }, p.end > end ? '→' : '')),
    ));
  }
  const ticks = h('div', { class: 'phase-row phase-ticks' }, h('span', { class: 'phase-name' }, t('num.ked.passmark')), h('span', { class: 'phase-track' }));
  for (const p of primaryPasses('kedah')) {
    ticks.lastElementChild?.append(h('span', { class: 'tick', style: `left:${pos(p.date_myt)}`, title: fmtDate(p.date_myt) }, p.direction === 'A' ? '▲' : '▼'));
  }
  chart.append(ticks);
  chart.append(h('span', { class: 'now-line', style: `left:calc(5.5rem + (100% - 5.5rem) * ${diffDays(s.date, start) / total})` }));
  const list = h('ul', { class: 'phase-list' }, (a.phases ?? []).map((p) =>
    h('li', {}, t('num.ked.phase', { id: p.id, ha: fmtNum(p.ha), start: fmtDay(p.start), end: fmtDate(p.end) }))));
  return h('div', {}, h('h3', { class: 'legend-title' }, t('num.ked.phases')), chart, list);
}

function numbersKedah(s: S.State): HTMLElement[] {
  // % of cropland with field water per NISAR pass: one line per stack (never mix stacks: different geometry),
  // ±1 dB band, MADA phase starts as reference rules; the first-flooded areas as ordered columns (map greens).
  const a = area('kedah');
  const passes = primaryPasses('kedah');
  const stackSeries = (track: string, name: string, color: string) => ({
    name, color, short: track.slice(0, 3),
    points: passes.filter((p) => p.track === track).flatMap((p) => {
      const v = kedDateByUtc(p.date_utc);
      return v ? [{ date: p.date_myt, y: v.pct_field_water, lo: v.pct_low, hi: v.pct_high, key: p.date_myt }] : [];
    }),
  });
  const series = [stackSeries('076_D_085', t('num.ked.stack076'), 'var(--viz-s1)'), stackSeries('112_A_005', t('num.ked.stack112'), 'var(--viz-s2)')].filter((se) => se.points.length);
  const bars = series.length && a.strip
    ? timeChart({
        title: t('num.ked.pct'), explain: t('num.ked.chart.explain'), subtitle: t('num.ked.chart.sub'), unit: '%',
        start: a.strip[0], end: a.strip[1], series,
        rules: (a.phases ?? []).map((p) => ({ date: p.start, label: t('phase.n', { id: p.id }) })),
        current: s.date, onPick: (d) => S.set({ date: d }),
        note: t('num.ked.chart.note'),
      })
    : h('ul', { class: 'pct-bars' }, passes.map((p) => h('li', {}, h('span', {}, fmtDay(p.date_myt)), segBar({ value: null, max: 100, basis: t('seg.pending') }), h('span', { class: 'num' }, '—%'))));
  const ff = stats?.kedah.first_flooded_ha;
  const firstCols = ff
    ? columnChart({
        title: t('num.ked.first.title'), explain: t('num.ked.first.explain'), subtitle: t('num.ked.first.sub'), unit: 'ha',
        cols: (layer('ked_first_flooded')?.classes ?? []).filter((c) => c.code >= 11 && c.color).map((c) => ({ label: FIRST_LABEL[c.code] ?? String(c.code), value: ff[String(c.code)] ?? 0, color: c.color as string })),
        note: t('num.ked.first.note', { notyet: fmtNum(ff['1'] ?? 0) }),
      })
    : null;
  const kp = kedPass(s.date);
  const season = area('kedah').phases ?? [];
  const seasonHa = 99489; // MADA notice, 14 Sep 2026 (plan 08 §4.7)
  const phaseBars = h('div', { class: 'stat-list' },
    h('h3', { class: 'legend-title' }, t('num.ked.phases')),
    ...season.map((p) => statRow(t('phase.n', { id: p.id }), segBar({ value: p.ha, max: seasonHa, basis: t('num.ked.phase.basis') }), `${fmtNum(p.ha)} ha`)),
    h('h3', { class: 'legend-title' }, t('num.ked.dams')),
    statRow(t('num.ked.dams.row'), segBar({ value: 35.76, delta: 40.13 - 35.76, max: 100, basis: t('num.ked.dams.basis') }), '35.76 → 40.13%',
      h('span', { class: 'delta' }, ' +4.37')),
    h('p', { class: 'src-line' }, src('The Star, 17 Sep 2026', 'https://www.thestar.com.my/news/nation/2026/09/17/water-levels-limited-at-three-mada-dams-in-kedah'), ' · ',
      src('Bernama, 13 Oct 2026', 'https://bernama.com/radio/news.php?id=2619837'), ' · ', src('MADA notice, 14 Sep 2026', 'https://www.mada.gov.my/?q=2F02&id=228')),
  );
  return [
    card(t('num.ked.title'), t('num.ked.tagline'),
      h('p', { class: 'headline-num' }, kp
        ? t('ked.headline', { pct: kp.pct_field_water, date: fmtDay(kp.date_myt), lo: kp.pct_low, hi: kp.pct_high })
        : t('ked.headline.placeholder', { date: fmtDay(s.date) })),
      badge(),
      kp ? methodNote(t('num.method.ked', { track: kp.track, ha: fmtNum(kp.paddy_ha_seen) })) : pendingNote(),
      bars,
      firstCols,
      phaseChart(s),
      phaseBars,
    ),
    card(t('num.ked.context.title'), t('num.ked.context.tagline'),
      h('ul', { class: 'facts' },
        h('li', {}, t('num.ked.context.1'), ' ', src(t('num.ked.context.1.src'), 'https://www.thestar.com.my/news/nation/2026/09/17/water-levels-limited-at-three-mada-dams-in-kedah')),
        h('li', {}, t('num.ked.context.2'), ' ', src(t('num.ked.context.2.src'), 'https://www.nst.com.my/amp/news/nation/2025/02/1181358/kedahs-rice-bowl-reborn-rm54bil-boost-rice-production')),
      ),
      h('p', { class: 'chain' }, t('num.ked.chain')),
    ),
  ];
}

// ---------------- Live (Kelantan this monsoon): what NASA has published so far ----------------

function liveNumbers(s: S.State): HTMLElement[] {
  const a = area(s.area);
  const facts = h('ul', { class: 'facts', 'aria-live': 'polite' }, h('li', { class: 'muted' }, t('live.days.loading')));
  const box = a.bbox as Bbox;
  const [start, end] = a.date_range ?? [a.default_date, a.default_date];
  Promise.all([latestTime('opera_dswx', box), latestTime('opera_rtc', box), latestTime('nisar_gcov', box)])
    .then(([dswx, rtc, nisar]) => {
      clear(facts);
      const row = (label: string, iso: string | null) =>
        h('li', {}, h('strong', {}, label), ' ', iso ? `${fmtDate(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC` : t('live.none'));
      facts.append(row(t('live.latest.dswx'), dswx), row(t('live.latest.rtc'), rtc), row(t('live.latest.nisar'), nisar));
    })
    .catch(() => {
      clear(facts);
      facts.append(h('li', { class: 'muted' }, t('live.days.error')));
    });
  const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
  return [
    card(t('live.title'), t('live.tagline'),
      h('p', {}, t('live.body')),
      h('h3', { class: 'legend-title' }, t('live.latest')),
      facts,
      h('p', { class: 'small' }, h('span', { class: 'hud-label' }, t('data.get')), ' ',
        link(t('data.earthdata'), earthdataSearchUrl('opera_dswx', box, start, end)), ' · ',
        link(t('data.vertex.nisar'), vertexUrl('nisar_gcov', box, start, end) ?? '#')),
      h('p', { class: 'pending small' }, t('live.notmeasured')),
    ),
  ];
}

function numbers(s: S.State): (HTMLElement | null)[] {
  const a = area(s.area);
  if (a.kind === 'live') return liveNumbers(s);
  if (imageryOnly(a)) return [card(t('num.exp.title'), t('exp.badge'), h('p', {}, t('num.exp.body')))];
  const out: (HTMLElement | null)[] = [districtCard(s), ...(s.area === 'kelantan' ? numbersKelantan(s) : numbersKedah(s))];
  // Simple mode and phones have no Rain tab: the rainfall chart joins the numbers there.
  if (mobile) out.push(...rain(s));
  return out;
}

// ---------------- Rain (F13 placeholder) ----------------

/** The radar pass nearest to a day, so a click on a rain bar moves the slider to a day that has a radar picture. */
function nearestPass(areaId: string, day: string): string | null {
  const list = primaryPasses(areaId);
  if (!list.length) return null;
  return list.reduce((a, p) => (Math.abs(diffDays(p.date_myt, day)) < Math.abs(diffDays(a.date_myt, day)) ? p : a), list[0]).date_myt;
}

/** "Heaviest rain … first radar picture after it …": the rain-to-radar link of plan 07 F13, always an estimate. */
function rainLag(areaId: string, peak: string): string | null {
  const after = primaryPasses(areaId).find((p) => p.date_myt >= peak);
  if (!after) return null;
  const n = diffDays(after.date_myt, peak);
  if (areaId === 'kelantan') {
    const v = kelPass(after.date_myt);
    return t('rain.lag.kel', { date: fmtDay(after.date_myt), n, ha: v ? haFmt(v.flood_ha) : '—' });
  }
  const before = [...primaryPasses(areaId)].reverse().find((p) => p.date_myt < peak);
  const v1 = kedDateByUtc(after.date_utc);
  const v0 = before ? kedDateByUtc(before.date_utc) : null;
  return t('rain.lag.ked', { date: fmtDay(after.date_myt), n, from: v0 ? `${v0.pct_field_water}%` : '—', to: v1 ? `${v1.pct_field_water}%` : '—' });
}

function rainChart(s: S.State): HTMLElement | null {
  const a = area(s.area);
  const r = rainData?.[s.area];
  if (!r || !a.strip) return null;
  const [start, end] = [a.strip[0] > r.start ? a.strip[0] : r.start, a.strip[1] < r.end ? a.strip[1] : r.end];
  const daily = Object.fromEntries(Object.entries(r.daily).filter(([d]) => d >= start && d <= end));
  const peak = Object.entries(daily).reduce((m, kv) => (kv[1] > m[1] ? kv : m), ['', -1] as [string, number]);
  const lag = peak[0] ? rainLag(s.area, peak[0]) : null;
  return h('div', {},
    dailyChart({
      title: t('rain.chart.title'),
      explain: t('rain.chart.explain'),
      subtitle: t('rain.chart.sub', { source: r.source.short }),
      note: t('rain.chart.note'),
      unit: 'mm', daily, start, end, color: 'var(--viz-rain)',
      marks: primaryPasses(s.area).map((p) => ({ date: p.date_myt, label: t('rain.chart.pass', { sensor: p.sensor, time: p.time_myt }) })),
      current: s.date,
      onPick: (d) => { const p = nearestPass(s.area, d); if (p) S.set({ date: p }); },
    }),
    peak[0] ? h('p', { class: 'small' }, t('rain.peak', { date: fmtDay(peak[0]), mm: num(peak[1]) }), lag ? ` ${lag}` : '') : null,
    h('p', { class: 'muted small' }, r.source.kind === 'reanalysis' ? t('rain.source.power') : t('rain.source.imerg', { name: r.source.name })),
  );
}

function rain(s: S.State): HTMLElement[] {
  const chart = rainChart(s);
  if (chart) return [card(t('rain.title'), t('rain.tagline'), chart)];
  const a = area(s.area);
  const days = a.strip ? daysBetween(a.strip[0], a.strip[1]) : [];
  const skeleton = h('div', { class: 'rain-skeleton', 'aria-hidden': 'true' }, days.map((d) =>
    h('span', { class: `rain-bar${primaryPasses(s.area).some((p) => p.date_myt === d) ? ' is-pass' : ''}${d === s.date ? ' is-current' : ''}` })));
  return [card(t('rain.title'), t('rain.tagline'), skeleton, pendingNote(), h('p', { class: 'muted small' }, t('rain.pending')), h('p', { class: 'small' }, t('rain.lag')))];
}

// ---------------- How sure are we? (F9) ----------------

export function sureCard(s: S.State): HTMLElement {
  const a = area(s.area);
  const first = h('ol', { class: 'sure-first' }, a.panel.sure_first.map((k) => h('li', {}, t(k))));
  const linkRow = (label: string, list: { label: string; url: string }[] | undefined) =>
    list?.length
      ? h('p', { class: 'small' }, h('span', { class: 'hud-label' }, t(label)), ' ',
          ...list.flatMap((l, i) => [i ? ' · ' : '', h('a', { href: l.url, target: '_blank', rel: 'noopener' }, t(l.label))]))
      : null;
  const el = h('section', { class: 'card sure-card', id: 'sure-card', tabindex: '-1' },
    h('h2', { class: 'card-title' }, t('sure.title')),
    h('p', { class: 'card-tagline' }, t('sure.tagline')),
    first,
    linkRow('sure.links', a.panel.official_links),
    linkRow('sure.learn', a.learn_links),
    h('button', { class: 'pill', 'aria-expanded': String(s.sureOpen), onclick: () => S.set({ sureOpen: !S.get().sureOpen }) }, t(s.sureOpen ? 'sure.less' : 'sure.more')),
  );
  if (s.sureOpen) el.append(sureDetails(s));
  return el;
}

function sureDetails(s: S.State): HTMLElement {
  const a = area(s.area);
  const v = s.area === 'kelantan' ? stats?.validation.kelantan : s.area === 'kedah' ? stats?.validation.kedah : undefined;
  const fmtR = (r?: { median: number; min: number; max: number }, unit = '') =>
    r ? `${r.median}${unit} (${r.min}–${r.max}${unit})` : '—';
  const value = (k: string): string =>
    k === 'sure.f1' ? fmtR(v?.summary.f1) : k === 'sure.iou' ? fmtR(v?.summary.iou) : k === 'sure.kappa' ? fmtR(v?.summary.kappa)
      : fmtR(v?.summary.date_gap_days, ' d');
  const metric = (k: string, gloss: string) => h('tr', {}, h('th', { scope: 'row' }, t(k)), h('td', { class: 'num' }, value(k)), h('td', {}, t(gloss)));
  const peak = s.area === 'kelantan' ? v?.per_date['2024-11-29'] : undefined;
  const det = h('div', { class: 'sure-details' },
    h('h3', { class: 'legend-title' }, t('sure.lines')),
    h('ul', { class: 'lim-list' }, a.panel.sure_lines.map((k) => {
      const [head, ...rest] = t(k).split('. ');
      return h('li', {}, h('strong', {}, `${head}.`), ' ', rest.join('. '));
    })),
  );
  if (imageryOnly(a)) return det;
  det.append(
    h('h3', { class: 'legend-title' }, t('sure.agreement')),
    h('p', { class: 'small' }, t(a.panel.validation ?? '')),
    v ? h('p', { class: 'small' }, t(s.area === 'kelantan' ? 'sure.agreement.kel' : 'sure.agreement.ked', { f1: peak?.f1 ?? '—', iou: peak?.iou ?? '—' }))
      : h('p', { class: 'pending small' }, t('sure.agreement.pending')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('sure.metric')), h('th', { scope: 'col' }, t('sure.value')), h('th', { scope: 'col' }, t('sure.meaning')))),
      h('tbody', {}, metric('sure.f1', 'sure.f1.gloss'), metric('sure.iou', 'sure.iou.gloss'), metric('sure.kappa', 'sure.kappa.gloss'), metric('sure.offset', 'sure.offset.gloss')),
    )),
    h('p', { class: 'small muted' }, t('sure.benchmark')),
    ...([brightnessChart(s)].filter(Boolean) as HTMLElement[]),
    valuesTable(s),
  );
  return det;
}

function valuesTable(s: S.State): HTMLElement {
  const kel = s.area === 'kelantan';
  const m = t('sure.values.measure');
  const kp = stats?.kelantan.dates['2024-11-29'];
  const kd = stats?.kedah.dates['2026-10-31'];
  const measured = (water: number | null | undefined, land: number | null | undefined, date: string) =>
    water != null && land != null ? t('values.measured', { water: water.toFixed(1), land: land.toFixed(1), date }) : null;
  const ownKel = measured(kp?.water_median_db, kp?.land_median_db, '29 Nov 2024');
  const ownHH = measured(kd?.hh_water_median_db, kd?.hh_land_median_db, '31 Oct 2026');
  const ownHV = measured(kd?.hv_water_median_db, kd?.hv_land_median_db, '31 Oct 2026');
  const rows: [string, string, string][] = kel
    ? [
        ['values.water', ownKel ? `${t('values.water.vv')} ${ownKel}` : t('values.water.vv'), t('values.water.vh')],
        ['values.paddy', `${t('values.dark')} · ${m}`, `${t('values.dark')} · ${m}`],
        ['values.forest', `${t('values.grey')} · ${m}`, `${t('values.brighter')} · ${m}`],
        ['values.town', `${t('values.town.c')} · ${m}`, m],
        ['values.dry', `${t('values.grey')} · ${m}`, `${t('values.grey')} · ${m}`],
      ]
    : [
        ['values.water', `${t('values.verydark')} · ${m}`, `${t('values.verydark')} · ${m}`],
        ['values.paddy', ownHH ? `${t('values.dark')} · ${ownHH}` : `${t('values.dark')} · ${m}`, ownHV ? `${t('values.dark')} · ${ownHV}` : `${t('values.dark')} · ${m}`],
        ['values.rice', `${t('values.rises')} · ${m}`, `${t('values.rises')} · ${m}`],
        ['values.forest', `${t('values.grey')} · ${m}`, `${t('values.brighter')} · ${m}`],
        ['values.town', `${t('values.bright')} · ${m}`, m],
        ['values.dry', `${t('values.grey')} · ${m}`, m],
      ];
  return h('div', {},
    h('h3', { class: 'legend-title' }, t('sure.values.title')),
    h('p', { class: 'muted small' }, t('sure.values.tagline')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('sure.values.surface')), h('th', { scope: 'col' }, kel ? 'VV' : 'HH'), h('th', { scope: 'col' }, kel ? 'VH' : 'HV'))),
      h('tbody', {}, rows.map(([k, a, b]) => h('tr', {}, h('th', { scope: 'row' }, t(k)), h('td', {}, a), h('td', {}, b)))),
    )),
  );
}

// ---------------- Story list ----------------

function storyTab(): HTMLElement[] {
  return [card(t('tab.story'), t('story.footer.past'),
    h('ol', { class: 'story-list' }, story.steps.map((st, i) =>
      h('li', {}, h('button', { class: 'link', onclick: () => S.set({ step: i }) }, t(st.title))))),
    h('button', { class: 'pill pill-primary', onclick: () => S.set({ step: 0 }) }, t('menu.story')),
  )];
}

// ---------------- About + credits (F10) ----------------

/** "How radar sees water": the echo types from NASA Earthdata's SAR basics page, tied to our layers. */
function radarExplainer(): HTMLElement {
  const row = (glyph: string, title: string, body: string) =>
    h('li', { class: 'echo-row' }, h('span', { class: 'echo-glyph', 'aria-hidden': 'true' }, glyph), h('div', {}, h('strong', {}, t(title)), ' ', t(body)));
  const bands = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('explain.band')), h('th', { scope: 'col' }, t('explain.wave')), h('th', { scope: 'col' }, t('explain.here')))),
    h('tbody', {},
      h('tr', {}, h('th', { scope: 'row' }, 'C'), h('td', { class: 'num' }, '3.8–7.5 cm'), h('td', {}, t('explain.c'))),
      h('tr', {}, h('th', { scope: 'row' }, 'S'), h('td', { class: 'num' }, '7.5–15 cm'), h('td', {}, t('explain.s'))),
      h('tr', {}, h('th', { scope: 'row' }, 'L'), h('td', { class: 'num' }, '15–30 cm'), h('td', {}, t('explain.l'))),
    ),
  ));
  return card(t('explain.title'), t('explain.tagline'),
    h('ul', { class: 'echo-list' },
      row('◢', 'explain.mirror.title', 'explain.mirror.body'),
      row('≋', 'explain.rough.title', 'explain.rough.body'),
      row('❦', 'explain.volume.title', 'explain.volume.body'),
      row('⌐', 'explain.double.title', 'explain.double.body'),
    ),
    bands,
    h('p', { class: 'src-line small' }, t('explain.src'), ' ',
      h('a', { href: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar', target: '_blank', rel: 'noopener' }, t('learn.sarbasics'))),
  );
}

/** What NASA said NISAR would do, before launch, in its one-page application overviews (2017). */
function nisarPromise(): HTMLElement {
  const quote = (text: string, src: string, url: string) =>
    h('blockquote', { class: 'quote' }, h('p', {}, `“${t(text)}”`), h('cite', { class: 'small' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, t(src))));
  return card(t('promise.title'), t('promise.tagline'),
    quote('promise.floods', 'promise.floods.src', 'https://assets.science.nasa.gov/content/dam/science/missions/nisar/nisar-jpl/pdf/NISAR_Applications_Floods.pdf'),
    quote('promise.food', 'promise.food.src', 'https://assets.science.nasa.gov/content/dam/science/missions/nisar/nisar-jpl/pdf/NISAR_Applications_Food_Security1.pdf'),
    h('p', { class: 'small' }, t('promise.us')),
  );
}

function learnMore(): HTMLElement {
  const items: [string, string][] = [
    ['learn.sarbasics', 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar'],
    ['learn.eobasics', 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics'],
    ['learn.arset', 'https://www.earthdata.nasa.gov/data/projects/arset'],
    ['learn.storymaps', 'https://science.nasa.gov/mission/nisar/arcgis-storymaps/'],
    ['learn.benefits', 'https://science.nasa.gov/mission/nisar/societal-benefits/'],
    ['learn.uavsar', 'https://uavsar.jpl.nasa.gov/education/postcards.html'],
    ['learn.nisardocs', 'https://nisar-docs.asf.alaska.edu/'],
    ['learn.earthdatasearch', 'https://search.earthdata.nasa.gov/search'],
    ['learn.vertex', 'https://search.asf.alaska.edu/#/'],
  ];
  return card(t('learn.title'), t('learn.tagline'),
    h('ul', { class: 'credits' }, items.map(([k, url]) => h('li', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, t(k)), ' · ', t(`${k}.what`)))),
    h('p', { class: 'muted small' }, t('learn.others')),
  );
}

function about(s: S.State): (HTMLElement | null)[] {
  const credits = ['credit.nisar', 'credit.rtc', 'credit.dswx', 'credit.gibs', 'credit.asf', 'credit.jrc', 'credit.dosm', 'credit.osm', 'credit.imerg', 'credit.worldcover', 'credit.worldpop', 'credit.dem', 'credit.news', 'credit.themes', 'credit.fonts', 'credit.libs', 'credit.noendorse'];
  const qa = (q: string, a2: string) => h('div', { class: 'qa' }, h('h3', { class: 'legend-title' }, t(q)), h('p', {}, t(a2)));
  return [
    mobile ? sureCard(s) : null,
    radarExplainer(),
    card(t('about.passdays.title'), t('lim.passdays').split('. ')[1] ?? '', h('p', {}, t('about.passdays.body'))),
    card(t('about.challenge.title'), t('app.subtitle'), qa('about.why.q', 'about.why.a'), qa('about.pol.q', 'about.pol.a'), qa('about.future.q', 'about.future.a')),
    nisarPromise(),
    learnMore(),
    card(t('about.credits.title'), t('about.credits.tagline'),
      h('ul', { class: 'credits' }, credits.map((k) => h('li', {}, t(k)))),
      h('details', {}, h('summary', {}, t('about.granules')),
        h('p', { class: 'muted small' }, t('about.granules.note')),
        h('ul', { class: 'granules' }, provenance.granules.map((g) => h('li', {}, h('span', { class: 'muted' }, `${g.product}: `), h('code', {}, g.id))))),
    ),
    card(t('about.ai.title'), t('about.prior'), h('p', {}, t('about.ai.body'))),
    card(t('about.glossary.title'), t('legend.tagline'),
      h('ul', { class: 'credits' }, ['gloss.sar', 'gloss.backscatter', 'gloss.hhhv', 'gloss.band', 'gloss.pass', 'gloss.track'].map((k) => h('li', {}, t(k))))),
  ];
}

// ---------------- render ----------------

function render(): void {
  const s = S.get();
  const list = tabs(s);
  const active = activeTab(s, list);
  clear(panelRoot);
  const tl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('tab.list') });
  for (const tab of list) {
    tl.append(h('button', {
      class: 'tab', role: 'tab', id: `tab-${tab.id}`, 'aria-selected': String(tab.id === active), 'aria-controls': 'tabpanel',
      tabindex: tab.id === active ? '0' : '-1',
      onclick: () => S.set({ tab: tab.id, sheet: S.get().sheet === 'peek' ? 'half' : S.get().sheet }),
      onkeydown: (e: Event) => {
        const k = (e as KeyboardEvent).key;
        if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
        const i = list.findIndex((x) => x.id === active);
        const n = list[(i + (k === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
        S.set({ tab: n.id });
        window.setTimeout(() => document.getElementById(`tab-${n.id}`)?.focus(), 0);
      },
    }, tab.label, tab.badge ? h('span', { class: 'tab-badge x-only' }, tab.badge) : null));
  }
  const content = h('div', { class: 'tabpanel', id: 'tabpanel', role: 'tabpanel', 'aria-labelledby': `tab-${active}` });
  let body: (HTMLElement | null)[] = [];
  if (active === 'layers') body = [titleCard, layersCard, legendCard];
  else if (active === 'numbers') body = numbers(s);
  else if (active === 'rain') body = rain(s);
  else if (active === 'sure') body = [sureCard(s)];
  else if (active === 'story') body = storyTab();
  else if (active === 'about') body = about(s);
  for (const b of body) if (b) content.append(b);
  // E · tab bar with Q / E hints and diamond page dots (hints hidden on touch screens).
  const idx = list.findIndex((x) => x.id === active);
  const bar = h('div', { class: 'tabbar' },
    h('button', { class: 'tab-key', 'aria-label': t('tabs.prev'), title: t('tabs.prev'), onclick: () => cycleTab(-1) }, 'Q'),
    tl,
    h('button', { class: 'tab-key', 'aria-label': t('tabs.next'), title: t('tabs.next'), onclick: () => cycleTab(1) }, 'E'),
  );
  const dots = h('div', { class: 'tab-dots', 'aria-hidden': 'true' }, list.map((_, k) => h('i', { class: k === idx ? 'on' : '' })));
  // Desktop header: the open section's name and the minimise button (the tab bar is hidden there; the rail replaces it).
  const head = h('header', { class: 'panel-head' }, h('h2', { id: 'panel-title' }, list[idx]?.label ?? ''), minimiseButton('panel'));
  if (!mobile) content.setAttribute('aria-labelledby', 'panel-title');
  panelRoot.append(head, bar, dots, content);
}

/** Q / E: previous / next panel tab (F25 shortcuts, E · tab bar). */
export function cycleTab(dir: 1 | -1): void {
  const s = S.get();
  const list = tabs(s);
  const i = list.findIndex((x) => x.id === activeTab(s, list));
  const n = list[(i + dir + list.length) % list.length];
  S.set({ tab: n.id, sheet: s.sheet === 'peek' ? 'half' : s.sheet });
}

export function initPanel(): void {
  render();
  S.subscribe((_s, ch) => {
    if (['area', 'date', 'mode', 'tab', 'district', 'sureOpen'].some((k) => ch.has(k as keyof S.State))) render();
  });
}

/** Called by layout when the left-column cards must return to the desktop column. */
export function rerenderPanel(): void {
  render();
}
