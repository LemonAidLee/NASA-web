// Small SVG charts for the side panel (no chart library). Built to the dataviz method:
// one y-axis per chart, thin marks (2 px lines, ≥ 8 px markers with a 2 px surface ring, ≤ 24 px bars with 4 px
// rounded data-ends), solid hairline grid, values in text tokens (never the series colour), a crosshair/tooltip on
// hover and keyboard focus, a legend for two or more series, and a table view for every chart.
// Colours are CSS variables (styles/charts.css), validated per theme surface with the dataviz palette validator.
import { h } from '../lib/dom';

const NS = 'http://www.w3.org/2000/svg';
const W = 320; // viewBox width; the SVG scales to the panel width

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c) el.append(c);
  return el;
}

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmtDay = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayLabel = (d: string): string => fmtDay.format(new Date(ms(d)));
const nf = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 });
export const num = (v: number): string => nf.format(v);

/** Clean axis ticks: 0, then 1/2/2.5/5 × 10^k steps up to the max. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const compact = (v: number) => (v >= 10_000 ? `${nf.format(v / 1000)}K` : nf.format(v));

// ---------- shared frame: tooltip, table view, legend ----------

interface Frame {
  root: HTMLElement;
  svg: SVGSVGElement;
  tip: HTMLElement;
}

function frame(title: string, subtitle: string, height: number, ariaLabel: string, explain?: string): Frame {
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'viz-svg', role: 'img', 'aria-label': ariaLabel });
  const tip = h('div', { class: 'viz-tip', role: 'status', hidden: true });
  const root = h('figure', { class: 'viz' },
    h('figcaption', {},
      h('span', { class: 'viz-title' }, title),
      explain ? h('span', { class: 'viz-explain' }, h('strong', {}, 'What it shows: '), explain) : null,
      subtitle ? h('span', { class: 'viz-sub' }, subtitle) : null),
    h('div', { class: 'viz-plot' }, svg, tip),
  );
  return { root, svg, tip };
}

/** "How to read it": one or two plain sentences under every chart. */
function howTo(text: string): HTMLElement {
  return h('p', { class: 'viz-note' }, h('strong', {}, 'How to read it: '), text);
}

/** Tooltip rows: value strong first, label after, keyed by a short line in the series colour (never a box). */
function showTip(f: Frame, x: number, y: number, head: string, rows: { color?: string; value: string; label: string }[]): void {
  f.tip.replaceChildren(
    h('p', { class: 'viz-tip-head' }, head),
    ...rows.map((r) => h('p', { class: 'viz-tip-row' },
      r.color ? h('span', { class: 'viz-key', style: `background:${r.color}`, 'aria-hidden': 'true' }) : null,
      h('strong', {}, r.value), ' ', h('span', {}, r.label))),
  );
  f.tip.hidden = false;
  const box = f.svg.getBoundingClientRect();
  const k = box.width / W;
  const left = Math.min(Math.max(x * k + 10, 0), box.width - 190);
  f.tip.style.left = `${left}px`;
  f.tip.style.top = `${Math.max(0, y * k - 8)}px`;
}
const hideTip = (f: Frame) => (f.tip.hidden = true);

/** viewBox x of a pointer event. */
function svgX(svg: SVGSVGElement, e: PointerEvent): number {
  const r = svg.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * W;
}

function legend(items: { color: string; label: string; kind: 'line' | 'rect' }[]): HTMLElement {
  return h('ul', { class: 'viz-legend' }, items.map((i) =>
    h('li', {}, h('span', { class: `viz-key viz-key-${i.kind}`, style: `background:${i.color}`, 'aria-hidden': 'true' }), i.label)));
}

/** "Show as table": the WCAG-clean twin of every chart, so no value is reachable by hover only. */
function tableView(head: string[], rows: (string | number)[][]): HTMLElement {
  return h('details', { class: 'viz-table' },
    h('summary', {}, 'Show as table'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, head.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, String(c)) : h('td', { class: 'num' }, String(c))))))),
    )),
  );
}

// ---------- 1 · time series (line + range band), with reference rules and the current date ----------

export interface TimePoint {
  date: string; // YYYY-MM-DD (plotted at this day)
  y: number;
  lo?: number;
  hi?: number;
  key?: string; // passed to onPick (e.g. the MYT date to jump to)
}
export interface TimeSeries {
  name: string;
  /** Short direct label at the line end (defaults to the name). */
  short?: string;
  color: string; // CSS colour, e.g. var(--viz-s1)
  points: TimePoint[];
}
export interface TimeChartOpts {
  title: string;
  /** One plain sentence: what the chart shows. */
  explain?: string;
  subtitle?: string;
  unit: string; // shown in tooltips, e.g. "ha" or "%"
  start: string;
  end: string;
  series: TimeSeries[];
  yMax?: number;
  rules?: { date: string; label: string }[];
  current?: string;
  onPick?: (key: string) => void;
  note?: string;
}

export function timeChart(o: TimeChartOpts): HTMLElement {
  const H = 170;
  const m = { l: 40, r: 12, t: 14, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const t0 = ms(o.start);
  const t1 = ms(o.end);
  const X = (d: string) => m.l + ((ms(d) - t0) / (t1 - t0)) * pw;
  const all = o.series.flatMap((se) => se.points.map((p) => Math.max(p.y, p.hi ?? p.y)));
  const ticks = niceTicks(o.yMax ?? Math.max(1, ...all));
  const yTop = ticks[ticks.length - 1];
  const Y = (v: number) => m.t + ph - (v / yTop) * ph;
  const f = frame(o.title, o.subtitle ?? '', H, `${o.title}. ${o.series.map((se) => `${se.name}: ${se.points.map((p) => `${dayLabel(p.date)} ${num(p.y)} ${o.unit}`).join(', ')}`).join('. ')}`, o.explain);
  const g = s('g');
  // grid + y ticks
  for (const v of ticks) {
    g.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'viz-base' : 'viz-grid' }));
    const tl = s('text', { x: m.l - 6, y: Y(v) + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    tl.textContent = compact(v);
    g.append(tl);
  }
  // x ticks: about weekly, labelled
  const span = (t1 - t0) / DAY;
  const stepD = span > 50 ? 14 : 7;
  for (let t = t0; t <= t1; t += stepD * DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const tl = s('text', { x: X(d), y: H - 6, class: 'viz-tick', 'text-anchor': 'middle' });
    tl.textContent = dayLabel(d);
    g.append(tl);
  }
  // reference rules (e.g. MADA phase starts): solid hairline in muted ink, labelled at the top
  for (const r of o.rules ?? []) {
    if (r.date < o.start || r.date > o.end) continue;
    g.append(s('line', { x1: X(r.date), x2: X(r.date), y1: m.t, y2: m.t + ph, class: 'viz-rule' }));
    const tl = s('text', { x: X(r.date) + 3, y: m.t + 8, class: 'viz-rule-label' });
    tl.textContent = r.label;
    g.append(tl);
  }
  // current date
  if (o.current && o.current >= o.start && o.current <= o.end) {
    g.append(s('line', { x1: X(o.current), x2: X(o.current), y1: m.t, y2: m.t + ph, class: 'viz-now' }));
  }
  // series: range band (10 % wash), 2 px line, ≥ 8 px markers with a surface ring
  for (const se of o.series) {
    const pts = [...se.points].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (pts.some((p) => p.lo !== undefined && p.hi !== undefined)) {
      const top = pts.map((p) => `${X(p.date)},${Y(p.hi ?? p.y)}`);
      const bot = [...pts].reverse().map((p) => `${X(p.date)},${Y(p.lo ?? p.y)}`);
      g.append(s('polygon', { points: [...top, ...bot].join(' '), fill: se.color, class: 'viz-band' }));
    }
    g.append(s('polyline', { points: pts.map((p) => `${X(p.date)},${Y(p.y)}`).join(' '), stroke: se.color, class: 'viz-line' }));
    for (const p of pts) {
      const isNow = p.key !== undefined && p.key === o.current;
      g.append(s('circle', { cx: X(p.date), cy: Y(p.y), r: isNow ? 5.5 : 4, fill: se.color, class: 'viz-dot' }));
    }
    // direct label at the line end (supplements the legend)
    const last = pts[pts.length - 1];
    if (last && o.series.length > 1) {
      const tl = s('text', { x: Math.min(X(last.date) + 6, W - m.r), y: Y(last.y) - 6, class: 'viz-end', 'text-anchor': X(last.date) > W - 60 ? 'end' : 'start' });
      tl.textContent = se.short ?? se.name;
      g.append(tl);
    }
  }
  // crosshair + tooltip: snap to the nearest data date (any series); one readout for every series at that date
  const cross = s('line', { y1: m.t, y2: m.t + ph, class: 'viz-cross', visibility: 'hidden' });
  const hit = s('rect', { x: m.l, y: 0, width: pw, height: H, class: 'viz-hit' });
  g.append(cross, hit);
  f.svg.append(g);
  const dates = [...new Set(o.series.flatMap((se) => se.points.map((p) => p.date)))].sort();
  const near = (x: number) => dates.reduce((a, d) => (Math.abs(X(d) - x) < Math.abs(X(a) - x) ? d : a), dates[0]);
  const readout = (d: string) => {
    cross.setAttribute('x1', String(X(d)));
    cross.setAttribute('x2', String(X(d)));
    cross.setAttribute('visibility', 'visible');
    const rows = o.series.flatMap((se) => {
      const p = se.points.find((q) => q.date === d);
      if (!p) return [];
      const range = p.lo !== undefined && p.hi !== undefined && (p.lo !== p.y || p.hi !== p.y) ? ` (${num(p.lo)}–${num(p.hi)})` : '';
      return [{ color: se.color, value: `${num(p.y)}${o.unit === '%' ? '' : ' '}${o.unit}${range}`, label: se.name }];
    });
    const yMin = Math.min(...o.series.flatMap((se) => se.points.filter((q) => q.date === d).map((q) => Y(q.y))));
    showTip(f, X(d), yMin, dayLabel(d), rows);
  };
  let picked: string | null = null;
  hit.addEventListener('pointermove', (e) => {
    picked = near(svgX(f.svg, e));
    readout(picked);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip(f);
  });
  if (o.onPick) {
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => {
      const p = picked ? o.series.flatMap((se) => se.points).find((q) => q.date === picked) : undefined;
      if (p?.key) o.onPick?.(p.key);
    });
  }
  // keyboard: arrow keys walk the dates, Enter picks
  f.svg.setAttribute('tabindex', '0');
  let ki = Math.max(0, dates.indexOf(o.current ?? ''));
  f.svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      ki = Math.min(dates.length - 1, Math.max(0, ki + (e.key === 'ArrowRight' ? 1 : -1)));
      picked = dates[ki];
      readout(picked);
      e.preventDefault();
    } else if (e.key === 'Enter' && o.onPick && picked) {
      const p = o.series.flatMap((se) => se.points).find((q) => q.date === picked);
      if (p?.key) o.onPick(p.key);
    }
  });
  f.svg.addEventListener('blur', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip(f);
  });
  if (o.series.length > 1) f.root.append(legend(o.series.map((se) => ({ color: se.color, label: se.name, kind: 'line' }))));
  if (o.note) f.root.append(howTo(o.note));
  const hasRange = o.series.some((se) => se.points.some((p) => p.lo !== undefined));
  f.root.append(tableView(
    ['Date', ...o.series.flatMap((se) => [`${se.name} (${o.unit})`, ...(hasRange ? ['Range'] : [])])],
    dates.map((d) => [dayLabel(d), ...o.series.flatMap((se) => {
      const p = se.points.find((q) => q.date === d);
      return [p ? num(p.y) : '—', ...(hasRange ? [p && p.lo !== undefined ? `${num(p.lo)}–${num(p.hi ?? p.y)}` : '—'] : [])];
    })]),
  ));
  return f.root;
}

// ---------- 2 · daily columns (rainfall), with radar-pass markers and the current date ----------

export interface DailyOpts {
  title: string;
  /** One plain sentence: what the chart shows. */
  explain?: string;
  subtitle?: string;
  unit: string;
  daily: Record<string, number>;
  start: string;
  end: string;
  color: string;
  marks?: { date: string; label: string }[]; // radar passes: a small tick under the axis
  current?: string;
  onPick?: (date: string) => void;
  note?: string;
}

export function dailyChart(o: DailyOpts): HTMLElement {
  const H = 170;
  const m = { l: 40, r: 10, t: 12, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const days: string[] = [];
  for (let t = ms(o.start); t <= ms(o.end); t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
  const slot = pw / days.length;
  const bw = Math.min(24, Math.max(1.5, slot - 2)); // 2 px surface gap between neighbours, ≤ 24 px
  const ticks = niceTicks(Math.max(1, ...days.map((d) => o.daily[d] ?? 0)));
  const yTop = ticks[ticks.length - 1];
  const Y = (v: number) => m.t + ph - (v / yTop) * ph;
  const X = (i: number) => m.l + i * slot + slot / 2;
  const f = frame(o.title, o.subtitle ?? '', H, `${o.title}, ${days.length} days, wettest ${(() => { const p = days.reduce((a, d) => ((o.daily[d] ?? 0) > (o.daily[a] ?? 0) ? d : a), days[0]); return `${dayLabel(p)} ${num(o.daily[p] ?? 0)} ${o.unit}`; })()}`, o.explain);
  const g = s('g');
  for (const v of ticks) {
    g.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'viz-base' : 'viz-grid' }));
    const tl = s('text', { x: m.l - 6, y: Y(v) + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    tl.textContent = compact(v);
    g.append(tl);
  }
  if (o.current) {
    const i = days.indexOf(o.current);
    if (i >= 0) g.append(s('line', { x1: X(i), x2: X(i), y1: m.t, y2: m.t + ph, class: 'viz-now' }));
  }
  days.forEach((d, i) => {
    const v = o.daily[d];
    if (v === undefined || v <= 0) return;
    const y = Y(v);
    const hgt = m.t + ph - y;
    const r = Math.min(4, bw / 2, hgt);
    // 4 px rounded data-end, square at the baseline
    const x0 = X(i) - bw / 2;
    const path = `M${x0},${m.t + ph} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x0 + bw - r} Q${x0 + bw},${y} ${x0 + bw},${y + r} V${m.t + ph} Z`;
    g.append(s('path', { d: path, fill: o.color, class: 'viz-bar' }));
  });
  // radar pass ticks under the axis, plus x labels about weekly
  for (const mk of o.marks ?? []) {
    const i = days.indexOf(mk.date);
    if (i < 0) continue;
    g.append(s('path', { d: `M${X(i) - 3.5},${m.t + ph + 9} L${X(i) + 3.5},${m.t + ph + 9} L${X(i)},${m.t + ph + 3} Z`, class: 'viz-pass' }));
  }
  days.forEach((d, i) => {
    if (i % 7 !== 0) return;
    const tl = s('text', { x: X(i), y: H - 4, class: 'viz-tick', 'text-anchor': 'middle' });
    tl.textContent = dayLabel(d);
    g.append(tl);
  });
  const cross = s('rect', { y: m.t, height: ph, width: slot, class: 'viz-cross-band', visibility: 'hidden' });
  const hit = s('rect', { x: m.l, y: 0, width: pw, height: H, class: 'viz-hit' });
  g.insertBefore(cross, g.firstChild);
  g.append(hit);
  f.svg.append(g);
  let picked = '';
  const readout = (i: number) => {
    const d = days[i];
    picked = d;
    cross.setAttribute('x', String(X(i) - slot / 2));
    cross.setAttribute('visibility', 'visible');
    const pass = (o.marks ?? []).find((mk) => mk.date === d);
    showTip(f, X(i), Y(o.daily[d] ?? 0), dayLabel(d), [
      { color: o.color, value: o.daily[d] === undefined ? 'no data' : `${num(o.daily[d])} ${o.unit}`, label: 'rain' },
      ...(pass ? [{ value: '▲', label: pass.label }] : []),
    ]);
  };
  hit.addEventListener('pointermove', (e) => readout(Math.min(days.length - 1, Math.max(0, Math.floor((svgX(f.svg, e) - m.l) / slot)))));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip(f);
  });
  if (o.onPick) {
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => picked && o.onPick?.(picked));
  }
  f.svg.setAttribute('tabindex', '0');
  let ki = Math.max(0, days.indexOf(o.current ?? ''));
  f.svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      ki = Math.min(days.length - 1, Math.max(0, ki + (e.key === 'ArrowRight' ? 1 : -1)));
      readout(ki);
      e.preventDefault();
    } else if (e.key === 'Enter' && o.onPick && picked) o.onPick(picked);
  });
  f.svg.addEventListener('blur', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip(f);
  });
  f.root.append(h('ul', { class: 'viz-legend' },
    h('li', {}, h('span', { class: 'viz-key viz-key-rect', style: `background:${o.color}`, 'aria-hidden': 'true' }), `Daily ${o.unit === 'mm' ? 'rainfall' : 'value'}`),
    o.marks?.length ? h('li', {}, h('span', { class: 'viz-key viz-key-pass', 'aria-hidden': 'true' }), 'Radar pass') : null,
  ));
  if (o.note) f.root.append(howTo(o.note));
  f.root.append(tableView(['Date', `Rain (${o.unit})`, 'Radar pass'],
    days.map((d) => [dayLabel(d), o.daily[d] === undefined ? '—' : num(o.daily[d]), (o.marks ?? []).find((mk) => mk.date === d)?.label ?? ''])));
  return f.root;
}

// ---------- 3 · ranked horizontal bars (one hue), with a range whisker ----------

export interface RankRow {
  label: string;
  value: number;
  lo?: number;
  hi?: number;
  key?: string;
  faded?: boolean;
}
export interface RankOpts {
  title: string;
  /** One plain sentence: what the chart shows. */
  explain?: string;
  subtitle?: string;
  unit: string;
  rows: RankRow[];
  color: string;
  selected?: string | null;
  onPick?: (key: string) => void;
  note?: string;
}

export function rankChart(o: RankOpts): HTMLElement {
  const rows = [...o.rows].sort((a, b) => b.value - a.value);
  const rowH = 22;
  const m = { l: 86, r: 70, t: 4, b: 4 };
  const H = m.t + m.b + rows.length * rowH;
  const pw = W - m.l - m.r;
  const max = Math.max(1, ...rows.map((r) => r.hi ?? r.value));
  const X = (v: number) => m.l + (v / max) * pw;
  const f = frame(o.title, o.subtitle ?? '', H, `${o.title}. ${rows.map((r) => `${r.label} ${num(r.value)} ${o.unit}`).join(', ')}`, o.explain);
  const g = s('g');
  g.append(s('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'viz-base' }));
  rows.forEach((r, i) => {
    const y = m.t + i * rowH + rowH / 2;
    const bh = Math.min(12, rowH - 6);
    const cls = `viz-rank${r.faded ? ' is-faded' : ''}${r.key && r.key === o.selected ? ' is-selected' : ''}`;
    const row = s('g', { class: cls, tabindex: o.onPick ? 0 : -1, role: o.onPick ? 'button' : 'presentation', 'aria-label': `${r.label}: ${num(r.value)} ${o.unit}` });
    const name = s('text', { x: m.l - 6, y: y + 3.5, class: 'viz-cat', 'text-anchor': 'end' });
    name.textContent = r.label;
    row.append(name);
    const w = Math.max(0, X(r.value) - m.l);
    if (w > 0) {
      const rr = Math.min(4, w, bh / 2);
      const x1 = m.l + w;
      row.append(s('path', { d: `M${m.l},${y - bh / 2} H${x1 - rr} Q${x1},${y - bh / 2} ${x1},${y - bh / 2 + rr} V${y + bh / 2 - rr} Q${x1},${y + bh / 2} ${x1 - rr},${y + bh / 2} H${m.l} Z`, fill: o.color, class: 'viz-bar' }));
    }
    if (r.lo !== undefined && r.hi !== undefined && r.hi > r.lo) {
      row.append(s('line', { x1: X(r.lo), x2: X(r.hi), y1: y, y2: y, class: 'viz-whisker' }));
    }
    const val = s('text', { x: Math.max(X(r.hi ?? r.value), m.l) + 5, y: y + 3.5, class: 'viz-val' });
    val.textContent = `${compact(r.value)} ${o.unit}`;
    row.append(val);
    row.append(s('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, class: 'viz-hit' }));
    if (o.onPick && r.key) {
      const pick = () => r.key && o.onPick?.(r.key);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      row.style.cursor = 'pointer';
    }
    row.addEventListener('pointermove', () => showTip(f, X(r.value), y, r.label, [
      { color: o.color, value: `${num(r.value)} ${o.unit}`, label: r.lo !== undefined ? `range ${num(r.lo)}–${num(r.hi ?? r.value)}` : '' },
    ]));
    row.addEventListener('pointerleave', () => hideTip(f));
    g.append(row);
  });
  f.svg.append(g);
  if (o.note) f.root.append(howTo(o.note));
  f.root.append(tableView(['Name', `Value (${o.unit})`, 'Range'], rows.map((r) => [r.label, num(r.value), r.lo !== undefined ? `${num(r.lo)}–${num(r.hi ?? r.value)}` : '—'])));
  return f.root;
}

// ---------- 4 · distributions (histograms as outlined areas), with the threshold ----------

export interface DistSeries {
  name: string;
  color: string;
  lo: number;
  step: number;
  pct: number[];
  emphasis?: boolean; // the one series the story is about gets the 10 % wash
}
export interface DistOpts {
  title: string;
  /** One plain sentence: what the chart shows. */
  explain?: string;
  subtitle?: string;
  xLabel: string;
  series: DistSeries[];
  threshold?: { value: number; label: string };
  note?: string;
}

export function distChart(o: DistOpts): HTMLElement {
  const H = 170;
  const m = { l: 34, r: 10, t: 14, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const xs = o.series.flatMap((se) => [se.lo, se.lo + se.step * se.pct.length]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const ticks = niceTicks(Math.max(1, ...o.series.flatMap((se) => se.pct)));
  const yTop = ticks[ticks.length - 1];
  const Y = (v: number) => m.t + ph - (v / yTop) * ph;
  const f = frame(o.title, o.subtitle ?? '', H, `${o.title}. ${o.threshold ? o.threshold.label : ''}`, o.explain);
  const g = s('g');
  for (const v of ticks) {
    g.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'viz-base' : 'viz-grid' }));
    const tl = s('text', { x: m.l - 5, y: Y(v) + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    tl.textContent = `${compact(v)}%`;
    g.append(tl);
  }
  for (let v = Math.ceil(x0 / 5) * 5; v <= x1; v += 5) {
    const tl = s('text', { x: X(v), y: m.t + ph + 12, class: 'viz-tick', 'text-anchor': 'middle' });
    tl.textContent = String(v);
    g.append(tl);
  }
  const xl = s('text', { x: m.l + pw / 2, y: H - 3, class: 'viz-tick', 'text-anchor': 'middle' });
  xl.textContent = o.xLabel;
  g.append(xl);
  for (const se of [...o.series].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis))) {
    const pts: string[] = [`${X(se.lo)},${Y(0)}`];
    se.pct.forEach((p, i) => {
      pts.push(`${X(se.lo + i * se.step)},${Y(p)}`, `${X(se.lo + (i + 1) * se.step)},${Y(p)}`);
    });
    pts.push(`${X(se.lo + se.pct.length * se.step)},${Y(0)}`);
    if (se.emphasis) g.append(s('polygon', { points: pts.join(' '), fill: se.color, class: 'viz-band' }));
    g.append(s('polyline', { points: pts.join(' '), stroke: se.color, class: 'viz-line viz-step' }));
  }
  if (o.threshold) {
    g.append(s('line', { x1: X(o.threshold.value), x2: X(o.threshold.value), y1: m.t, y2: m.t + ph, class: 'viz-rule viz-threshold' }));
    const tl = s('text', { x: X(o.threshold.value) - 3, y: m.t + 8, class: 'viz-rule-label', 'text-anchor': 'end' });
    tl.textContent = o.threshold.label;
    g.append(tl);
  }
  const cross = s('line', { y1: m.t, y2: m.t + ph, class: 'viz-cross', visibility: 'hidden' });
  const hit = s('rect', { x: m.l, y: 0, width: pw, height: H, class: 'viz-hit' });
  g.append(cross, hit);
  f.svg.append(g);
  const step = o.series[0]?.step ?? 1;
  const readout = (v: number) => {
    const b = Math.floor((v - x0) / step) * step + x0;
    cross.setAttribute('x1', String(X(b + step / 2)));
    cross.setAttribute('x2', String(X(b + step / 2)));
    cross.setAttribute('visibility', 'visible');
    showTip(f, X(b + step / 2), m.t + 10, `${num(b)} to ${num(b + step)} dB`, o.series.map((se) => {
      const i = Math.round((b - se.lo) / se.step);
      return { color: se.color, value: `${num(se.pct[i] ?? 0)}%`, label: se.name };
    }));
  };
  hit.addEventListener('pointermove', (e) => readout(x0 + ((svgX(f.svg, e) - m.l) / pw) * (x1 - x0)));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip(f);
  });
  f.root.append(legend(o.series.map((se) => ({ color: se.color, label: se.name, kind: 'line' }))));
  if (o.note) f.root.append(howTo(o.note));
  // table: 1 dB bins keep it readable
  const se0 = o.series[0];
  const rows: (string | number)[][] = [];
  if (se0) {
    for (let b = se0.lo; b < se0.lo + se0.step * se0.pct.length; b += 1) {
      rows.push([`${num(b)} to ${num(b + 1)}`, ...o.series.map((se) => {
        const i = Math.round((b - se.lo) / se.step);
        return num((se.pct[i] ?? 0) + (se.pct[i + 1] ?? 0));
      })]);
    }
  }
  f.root.append(tableView([`${o.xLabel}`, ...o.series.map((se) => `${se.name} (%)`)], rows));
  return f.root;
}

// ---------- 5 · columns for a few ordered categories (ordinal hues) ----------

export interface ColumnOpts {
  title: string;
  /** One plain sentence: what the chart shows. */
  explain?: string;
  subtitle?: string;
  unit: string;
  cols: { label: string; value: number; color: string }[];
  note?: string;
}

export function columnChart(o: ColumnOpts): HTMLElement {
  const H = 150;
  const m = { l: 40, r: 10, t: 16, b: 22 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const slot = pw / o.cols.length;
  const bw = Math.min(24, slot - 2);
  const ticks = niceTicks(Math.max(1, ...o.cols.map((c) => c.value)));
  const yTop = ticks[ticks.length - 1];
  const Y = (v: number) => m.t + ph - (v / yTop) * ph;
  const f = frame(o.title, o.subtitle ?? '', H, `${o.title}. ${o.cols.map((c) => `${c.label} ${num(c.value)} ${o.unit}`).join(', ')}`, o.explain);
  const g = s('g');
  for (const v of ticks) {
    g.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'viz-base' : 'viz-grid' }));
    const tl = s('text', { x: m.l - 6, y: Y(v) + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    tl.textContent = compact(v);
    g.append(tl);
  }
  o.cols.forEach((c, i) => {
    const cx = m.l + i * slot + slot / 2;
    const y = Y(c.value);
    const hgt = m.t + ph - y;
    const r = Math.min(4, bw / 2, hgt);
    const x0 = cx - bw / 2;
    const col = s('g', { class: 'viz-col', tabindex: 0, role: 'img', 'aria-label': `${c.label}: ${num(c.value)} ${o.unit}` });
    if (hgt > 0) col.append(s('path', { d: `M${x0},${m.t + ph} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x0 + bw - r} Q${x0 + bw},${y} ${x0 + bw},${y + r} V${m.t + ph} Z`, fill: c.color, class: 'viz-bar' }));
    const val = s('text', { x: cx, y: y - 4, class: 'viz-val', 'text-anchor': 'middle' });
    val.textContent = num(c.value); // one style for every column label
    const lab = s('text', { x: cx, y: H - 6, class: 'viz-tick', 'text-anchor': 'middle' });
    lab.textContent = c.label;
    col.append(val, lab, s('rect', { x: cx - slot / 2, y: 0, width: slot, height: H, class: 'viz-hit' }));
    col.addEventListener('pointermove', () => showTip(f, cx, y, c.label, [{ color: c.color, value: `${num(c.value)} ${o.unit}`, label: '' }]));
    col.addEventListener('pointerleave', () => hideTip(f));
    g.append(col);
  });
  f.svg.append(g);
  if (o.note) f.root.append(howTo(o.note));
  f.root.append(tableView(['Group', `Value (${o.unit})`], o.cols.map((c) => [c.label, num(c.value)])));
  return f.root;
}
