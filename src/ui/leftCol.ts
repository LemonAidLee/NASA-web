// Left column: title card + area switch (F1), layer dock / "What's on the map" (F2), legend (F4), Explore controls (F31).
import { area, cfg, fmtDate, fmtDay, focusFor, imageryOnly, layer, layersFor, outlineId, primaryPasses, studyBbox, studyOutlines, type Area, type ClassDef, type LayerDef } from '../config';
import { allDistrictShapes } from '../map/districts';
import { t } from '../i18n';
import { clear, h } from '../lib/dom';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { flyTo, map } from '../map/mainMap';
import { acquisitionDays, earthdataSearchUrl, vertexUrl, worldviewUrl, type Bbox } from '../lib/catalog';
import { latestInfo } from '../map/latestNisar';

export const titleCard = h('section', { class: 'card title-card', id: 'titlecard' });
export const layersCard = h('section', { class: 'card layers-card', id: 'layers-card' });
export const legendCard = h('section', { class: 'card legend-card', id: 'legend-card' });
export const legendChip = h('button', { class: 'legend-chip mobile-only', onclick: () => S.set({ tab: 'layers', sheet: 'half' }) });

const AREA_PILLS: [string, string][] = [
  ['kelantan', 'area.pill.kelantan'],
  ['kedah', 'area.pill.kedah'],
  ['kelantan_live', 'area.pill.live'],
  ['explore', 'area.pill.explore'],
];

export function switchArea(id: string): void {
  const a = area(id);
  const patch: Partial<S.State> = { area: id, date: a.default_date, district: null, playing: false };
  if (S.get().compare !== 'off' && imageryOnly(a)) patch.compare = 'off';
  if (!imageryOnly(a)) {
    patch.cmpA = a.compare_default?.[0] ?? a.default_date;
    patch.cmpB = a.compare_default?.[1] ?? a.default_date;
  }
  S.set(patch);
  if (a.kind === 'explore' && a.presets?.[0]) flyTo(a.presets[0].center, a.presets[0].zoom);
}

function swatch(colors: string[] | undefined, extra = ''): HTMLElement {
  const el = h('span', { class: `swatch ${extra}`, 'aria-hidden': 'true' });
  if (!colors) return el;
  if (colors[0] === 'line') {
    el.classList.add('swatch-line');
    return el;
  }
  el.style.background = colors.length === 1 ? colors[0] : `linear-gradient(90deg, ${colors.join(', ')})`;
  return el;
}

function renderTitle(): void {
  const s = S.get();
  const a = area(s.area);
  clear(titleCard);
  const pills = h('div', { class: 'area-pills', role: 'group', 'aria-label': t('area.switch.label') });
  for (const [id, key] of AREA_PILLS) {
    pills.append(h('button', { class: 'pill', 'aria-pressed': String(s.area === id), onclick: () => switchArea(id) }, t(key)));
  }
  pills.classList.add('dest-fallback'); // phones keep the plain buttons; desktop shows the destination picker (G)
  titleCard.append(
    h('h1', { class: 'card-title app-name' }, t('app.title')),
    h('p', { class: 'card-tagline' }, t('app.subtitle')),
    h('p', { class: 'chip chip-proto', title: t('app.prototype.long') }, t('app.prototype')),
    destPicker(s),
    pills,
    h('p', { class: 'question' }, t(a.panel.question)),
    h('p', { class: 'sensor' }, t(a.panel.sensor)),
  );
  if (imageryOnly(a)) {
    titleCard.append(exploreControls(a));
  } else {
    titleCard.append(
      h('div', { class: 'headline' },
        h('p', {}, t(a.panel.headline, { date: fmtDate(s.date) })),
        h('button', { class: 'badge badge-link', onclick: () => S.set({ tab: 'sure', sheet: 'half' }) }, t('num.badge')),
      ),
      h('button', { class: 'pill pill-primary', onclick: () => S.set(s.compare === 'off' ? compareDefault() : { compare: 'off' }) },
        t(s.compare === 'off' ? 'compare.open' : 'compare.close')),
    );
  }
}

// ---------- G · destination picker: a mini star chart drawn from the real DOSM district shapes ----------

const DEST_VIEW = { w: 99.55, e: 103.05, n: 6.95, s: 4.45 }; // lon/lat window; equirectangular is fine at 5–7°N
const DEST_H = ((DEST_VIEW.n - DEST_VIEW.s) / (DEST_VIEW.e - DEST_VIEW.w)) * 100;
const px = (lon: number) => ((lon - DEST_VIEW.w) / (DEST_VIEW.e - DEST_VIEW.w)) * 100;
const py = (lat: number) => ((DEST_VIEW.n - lat) / (DEST_VIEW.e - DEST_VIEW.w)) * 100;
// "Anywhere" has no place of its own: it sits off the chart's south-east, drawn dashed.
const ANYWHERE_AT: [number, number] = [102.55, 4.75];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function ringPath(polys: number[][][][]): string {
  return polys.map((p) => 'M' + p[0].map(([x, y]) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`).join('L') + 'Z').join('');
}

function destPicker(s: S.State): HTMLElement {
  const svg = svgEl('svg', { viewBox: `0 0 100 ${DEST_H.toFixed(2)}`, class: 'dest-svg', 'aria-hidden': 'true' });
  svg.append(svgEl('ellipse', { cx: '55', cy: `${(DEST_H * 0.55).toFixed(1)}`, rx: '46', ry: `${(DEST_H * 0.36).toFixed(1)}`, class: 'dest-orbit' }));
  svg.append(svgEl('ellipse', { cx: '55', cy: `${(DEST_H * 0.55).toFixed(1)}`, rx: '30', ry: `${(DEST_H * 0.22).toFixed(1)}`, class: 'dest-orbit dest-orbit-dash' }));
  for (const d of allDistrictShapes()) svg.append(svgEl('path', { d: ringPath(d.polys), class: 'dest-land' }));
  for (const o of studyOutlines) {
    const rings = (o.geometry.type === 'Polygon' ? [o.geometry.coordinates] : o.geometry.coordinates) as number[][][][];
    svg.append(svgEl('path', { d: ringPath(rings), class: `dest-study${o.properties.id === outlineId(s.area) ? ' is-on' : ''}` }));
  }
  const places = cfg.areas.map((a) => {
    const b = studyBbox(a.id);
    const at: [number, number] = a.kind === 'explore' ? ANYWHERE_AT : a.pick_at ?? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    return { a, at };
  });
  const k = places.find((p) => p.a.id === 'kedah');
  const l = places.find((p) => p.a.id === 'kelantan');
  const lv = places.find((p) => p.a.kind === 'live');
  const x = places.find((p) => p.a.kind === 'explore');
  const link = (p: typeof k, q: typeof k, cls: string) =>
    p && q && svg.append(svgEl('line', { x1: `${px(p.at[0])}`, y1: `${py(p.at[1])}`, x2: `${px(q.at[0])}`, y2: `${py(q.at[1])}`, class: cls }));
  link(k, l, 'dest-link');
  link(l, lv, 'dest-link dest-link-dash');
  link(lv ?? l, x, 'dest-link dest-link-dash');

  const caption = h('p', { class: 'dest-caption', 'aria-live': 'polite' });
  const describe = (id: string) => {
    const a = area(id);
    clear(caption);
    const nf = focusFor(id).length;
    const np = primaryPasses(id).length;
    caption.append(h('strong', {}, t(a.short)), ' ',
      h('span', {}, a.kind === 'explore' ? t('dest.anywhere') : a.kind === 'live' ? t('dest.live') : [t(a.name), t('dest.passes', { n: np }), t('dest.focus', { n: nf })].join(' · ')));
  };
  const stage = h('div', { class: 'dest-stage', style: `aspect-ratio: 100 / ${DEST_H.toFixed(2)}` }, svg);
  for (const { a, at } of places) {
    const node = h('button', {
      class: `dest-node${a.id === s.area ? ' is-on' : ''}${a.kind === 'explore' ? ' is-any' : ''}`,
      style: `left:${px(at[0]).toFixed(2)}%;top:${((py(at[1]) / DEST_H) * 100).toFixed(2)}%`,
      'aria-pressed': String(a.id === s.area),
      'aria-label': t('dest.label', { name: t(a.short), sub: a.kind === 'explore' ? t('dest.anywhere') : a.kind === 'live' ? t('dest.live') : t(a.name) }),
      onclick: () => switchArea(a.id),
      onmouseenter: () => describe(a.id),
      onfocus: () => describe(a.id),
      onmouseleave: () => describe(S.get().area),
      onblur: () => describe(S.get().area),
    }, h('span', { class: 'dest-orb', 'aria-hidden': 'true' }), h('span', { class: 'dest-name' }, t(a.short)));
    stage.append(node);
  }
  describe(s.area);
  return h('div', { class: 'dest-picker', role: 'group', 'aria-label': t('dest.title') },
    h('p', { class: 'hud-label dest-title' }, t('dest.title')),
    stage,
    caption,
  );
}

// ---------- D · quick-toggle sockets above the layer rows (names stay in the rows below) ----------

function socketStrip(list: LayerDef[]): HTMLElement | null {
  const s = S.get();
  const items = list.filter((l) => l.abbr);
  if (!items.length) return null;
  return h('div', { class: 'sock-strip' },
    h('span', { class: 'hud-label' }, t('sock.title')),
    h('div', { class: 'sock-row' }, items.map((l) => {
      const on = l.base ? s.base === 'sat' || s.layers[l.id]?.on : s.layers[l.id]?.on;
      const pending = l.status === 'placeholder';
      return h('button', {
        class: `sock${on ? ' on' : ''}${pending ? ' pend' : ''}`, 'aria-pressed': String(!!on),
        'aria-label': pending ? `${t(l.name)} (${t('sock.pending')})` : t(l.name), title: pending ? `${t(l.name)} · ${t('sock.pending')}` : t(l.name),
        onclick: () => {
          if (l.base) S.set({ base: on ? 'map' : 'sat', layers: { ...S.get().layers, [l.id]: { ...S.get().layers[l.id], on: !on } } });
          else S.setLayer(l.id, { on: !on });
        },
      }, l.abbr as string);
    })),
    h('span', { class: 'sock-legend' }, t('sock.legend')),
  );
}

function exploreControls(a: Area): HTMLElement {
  const s = S.get();
  const live = a.kind === 'live';
  const [min, max] = a.date_range ?? ['2025-10-29', new Date().toISOString().slice(0, 10)];
  const input = h('input', {
    type: 'date', class: 'input', min, max, value: s.date, 'aria-label': t('exp.date'),
    onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      if (v >= min && v <= max) S.set({ date: v });
    },
  });
  const presets = h('div', { class: 'area-pills' });
  for (const p of a.presets ?? []) {
    presets.append(h('button', { class: 'pill pill-sm', onclick: () => { S.set({ date: p.date }); flyTo(p.center, p.zoom); } }, t(p.label)));
  }
  return h('div', { class: 'explore' },
    h('p', { class: 'badge badge-imagery' }, t(live ? 'live.badge' : 'exp.badge')),
    h('label', { class: 'field' }, h('span', { class: 'hud-label' }, t('exp.date')), input),
    live ? livePassDays(a, s.date) : h('span', { class: 'hud-label' }, t('exp.presets')),
    live ? null : presets,
    h('p', { class: 'muted small' }, t(live ? 'live.empty' : 'exp.empty')),
  );
}

// ---------- live area: radar pass days, read from NASA's catalogue on each visit ----------

interface PassDay {
  day: string;
  sensors: string[];
}
const passDayCache = new Map<string, Promise<PassDay[]>>();

function loadPassDays(a: Area): Promise<PassDay[]> {
  const [start, end] = a.date_range ?? [a.default_date, a.default_date];
  const key = `${a.id}|${start}|${end}`;
  let p = passDayCache.get(key);
  if (!p) {
    const box = a.bbox as Bbox;
    p = Promise.all([acquisitionDays('opera_dswx', box, start, end), acquisitionDays('nisar_gcov', box, start, end)]).then(([s1, ni]) => {
      const days = new Map<string, string[]>();
      for (const d of s1) days.set(d, ['Sentinel-1']);
      for (const d of ni) days.set(d, [...(days.get(d) ?? []), 'NISAR']);
      return [...days.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([day, sensors]) => ({ day, sensors }));
    });
    p.catch(() => passDayCache.delete(key));
    passDayCache.set(key, p);
  }
  return p;
}

function livePassDays(a: Area, current: string): HTMLElement {
  const list = h('div', { class: 'area-pills pass-days', 'aria-live': 'polite' }, h('span', { class: 'muted small' }, t('live.days.loading')));
  loadPassDays(a)
    .then((days) => {
      clear(list);
      if (!days.length) list.append(h('span', { class: 'muted small' }, t('live.days.none')));
      for (const d of days.slice(0, 12)) {
        list.append(h('button', {
          class: 'pill pill-sm', 'aria-pressed': String(d.day === current),
          title: t('live.days.title', { date: fmtDate(d.day), sensors: d.sensors.join(' + ') }),
          onclick: () => S.set({ date: d.day }),
        }, `${fmtDay(d.day)} · ${d.sensors.map((x) => (x === 'NISAR' ? 'NI' : 'S1')).join('+')}`));
      }
    })
    .catch(() => {
      clear(list);
      list.append(h('span', { class: 'muted small' }, t('live.days.error')));
    });
  return h('div', { class: 'live-days' },
    h('span', { class: 'hud-label' }, t('live.days')),
    list,
    h('p', { class: 'muted small' }, t('live.days.lag')),
  );
}

// ---------- "Get this data": open the same product, place and dates in NASA's own tools ----------

function dataWindow(a: Area, s: S.State): [string, string] {
  if (a.strip) return a.strip;
  if (a.date_range) return [a.date_range[0], a.date_range[1]];
  return [s.date, s.date];
}

function dataLinks(l: LayerDef, s: S.State): HTMLElement | null {
  if (!l.collection) return null;
  const a = area(s.area);
  const box: Bbox = a.kind === 'explore' ? (() => {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v * 100) / 100) as Bbox;
  })() : (a.bbox as Bbox);
  const [start, end] = a.kind === 'explore' ? [s.date, s.date] : dataWindow(a, s);
  const vx = vertexUrl(l.collection, box, start, end);
  const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
  return h('p', { class: 'layer-links small' },
    h('span', { class: 'hud-label' }, t('data.get')), ' ',
    link(t('data.earthdata'), earthdataSearchUrl(l.collection, box, start, end)),
    vx ? ' · ' : null, vx ? link(t('data.vertex'), vx) : null,
    l.wms_layer ? ' · ' : null, l.wms_layer ? link(t('data.worldview'), worldviewUrl(l.wms_layer, box, s.date)) : null,
  );
}

/** Status line under the "newest NISAR picture" row: which pass, or why there is nothing. */
function latestLine(): HTMLElement {
  const i = latestInfo;
  const f = i.frames[0];
  const text =
    i.state === 'loading' ? t('latest.loading')
      : i.state === 'ok' && f ? t('latest.ok', { date: fmtDate(f.time.slice(0, 10)), time: f.time.slice(11, 16), track: `${f.path} ${f.direction === 'ASCENDING' ? 'A' : 'D'}`, n: i.frames.length })
        : i.state === 'none' ? t('latest.none')
          : i.state === 'error' ? t('latest.error')
            : t('latest.idle');
  return h('p', { class: 'layer-status small', 'aria-live': 'polite' }, text);
}

function layerRow(l: LayerDef, expert: boolean): HTMLElement {
  const s = S.get();
  const ls = s.layers[l.id];
  const on = l.base ? s.base === 'sat' || ls.on : ls.on;
  const id = `lyr-${l.id}`;
  const tag =
    l.status === 'placeholder'
      ? h('span', { class: 'tag tag-pending', title: t('layers.pending.long') }, t('layers.pending'))
      : l.preview
        ? h('span', { class: 'tag', title: t('layers.preview.long') }, t('layers.preview'))
        : null;
  const info = h('div', { class: 'layer-info', hidden: true, id: `${id}-info` },
    h('p', {}, t(l.info), l.status === 'placeholder' ? ` ${t('layers.pending.long')}` : ''),
    dataLinks(l, s),
  );
  const row = h(
    'li',
    { class: `layer-row${on ? ' is-on' : ''}${l.status === 'placeholder' ? ' is-pending' : ''}` },
    h('label', { class: 'layer-main', for: id },
      h('input', {
        type: 'checkbox', id, checked: on,
        onchange: (e: Event) => {
          const checked = (e.target as HTMLInputElement).checked;
          if (l.base) S.set({ base: checked ? 'sat' : 'map', layers: { ...S.get().layers, [l.id]: { ...ls, on: checked } } });
          else S.setLayer(l.id, { on: checked });
        },
      }),
      swatch(l.swatch),
      h('span', { class: 'layer-name' }, t(l.name), tag ? ' ' : null, tag),
    ),
    h('button', {
      class: 'icon-btn', 'aria-label': t('layers.info', { name: t(l.name) }), 'aria-expanded': 'false', 'aria-controls': `${id}-info`,
      onclick: (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        info.hidden = !info.hidden;
        btn.setAttribute('aria-expanded', String(!info.hidden));
      },
    }, 'i'),
    l.kind === 'browse' && on ? latestLine() : null,
    expert && l.kind !== 'vector'
      ? h('input', {
          type: 'range', class: 'opacity', min: 0, max: 1, step: 0.05, value: ls.opacity,
          'aria-label': t('layers.opacity', { name: t(l.name) }),
          oninput: (e: Event) => S.setLayer(l.id, { opacity: Number((e.target as HTMLInputElement).value) }),
        })
      : null,
    info,
  );
  return row;
}

function renderLayers(): void {
  const s = S.get();
  const expert = s.mode === 'expert';
  clear(layersCard);
  layersCard.append(
    h('h2', { class: 'card-title' }, t(expert ? 'layers.title.expert' : 'layers.title')),
    h('p', { class: 'card-tagline' }, t('layers.tagline')),
  );
  const strip = socketStrip(layersFor(s.area).filter((l) => (expert ? !l.expert_only || expert : l.simple)));
  if (strip) layersCard.append(strip);
  const list = layersFor(s.area).filter((l) => (expert ? !l.expert_only || expert : l.simple));
  const groups = new Map<string, LayerDef[]>();
  for (const l of list) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  for (const [g, ls] of groups) {
    const onCount = ls.filter((l) => (l.base ? s.base === 'sat' || s.layers[l.id].on : s.layers[l.id].on)).length;
    layersCard.append(
      h('h3', { class: 'hud-label group-label x-only' }, `${t(g)} `, h('span', { class: 'count' }, `${onCount}/${ls.length}`)),
      h('ul', { class: 'layer-list' }, ls.map((l) => layerRow(l, expert))),
    );
    if (ls.some((l) => l.exclusive_with?.length)) layersCard.append(h('p', { class: 'muted small x-only' }, t('layers.radio')));
  }
}

function classItem(c: ClassDef, pending: boolean): HTMLElement {
  const cls = c.style === 'hatch' ? 'swatch-hatch' : c.style === 'hatch-fill' ? 'swatch-hatch-fill' : c.style === 'none' ? 'swatch-none' : '';
  const sw = swatch(c.color ? [c.color] : undefined, cls);
  return h('li', { class: pending ? 'is-pending' : '' }, sw, h('span', {}, t(c.name, { date: '…' })));
}

function legendBlock(title: string, items: [string | null, string, string?][], note?: string): HTMLElement {
  return h('div', { class: 'legend-block' },
    h('h3', { class: 'legend-title' }, title),
    h('ul', { class: 'legend-list' }, items.map(([color, text, cls]) => h('li', {}, swatch(color ? [color] : undefined, cls ?? ''), h('span', {}, text)))),
    note ? h('p', { class: 'muted small' }, note) : null,
  );
}

function renderLegend(): void {
  const s = S.get();
  const a = area(s.area);
  clear(legendCard);
  legendCard.append(h('h2', { class: 'card-title' }, t('legend.title')), h('p', { class: 'card-tagline' }, t('legend.tagline')));
  legendCard.append(h('div', { class: 'legend-block' },
    h('ul', { class: 'legend-list' }, h('li', {},
      h('span', {
        class: 'swatch swatch-dots', 'aria-hidden': 'true',
        style: `background: repeating-linear-gradient(90deg, ${cfg.legend_colors.study.line} 0 6px, ${cfg.legend_colors.study.casing} 6px 9px); box-shadow: 0 0 0 1.5px ${cfg.legend_colors.study.casing};`,
      }),
      h('span', {}, h('strong', {}, t('legend.study.title')), ' · ', t('legend.study.body')))),
  ));
  const chipColors: string[] = [];
  const lc = cfg.legend_colors;
  const on = (id: string) => {
    const l = layer(id);
    return !!l && l.areas.includes(s.area) && (l.base ? s.base === 'sat' || s.layers[id]?.on : s.layers[id]?.on);
  };
  const classLayer = a.panel.legend_layer ? layer(a.panel.legend_layer) : undefined;
  if (classLayer && on(classLayer.id) && classLayer.classes) {
    legendCard.append(
      h('div', { class: 'legend-block' },
        h('h3', { class: 'legend-title' }, t(classLayer.name)),
        h('ul', { class: 'legend-list' }, classLayer.classes.map((c) => classItem(c, true))),
        h('p', { class: 'muted small' }, t('legend.pending')),
      ),
    );
  }
  for (const l of layersFor(s.area)) {
    if (!on(l.id)) continue;
    if (l.legend === 'dswx') {
      legendCard.append(legendBlock(t('legend.dswx.title'), [
        [lc.dswx['1'], t('legend.dswx.1')], [lc.dswx['3'], t('legend.dswx.3')], [lc.dswx['0'], t('legend.dswx.0')],
        [lc.dswx['250'], t('legend.dswx.250')], [lc.dswx['251'], t('legend.dswx.251')],
      ]));
      chipColors.push(lc.dswx['1']);
    } else if (l.legend === 'nisar') {
      legendCard.append(legendBlock(t('legend.nisar.title'), [
        [lc.nisar.blue, t('legend.nisar.blue')], [lc.nisar.green, t('legend.nisar.green')],
        [lc.nisar.pink, t('legend.nisar.pink')], [lc.nisar.black, t('legend.nisar.black')],
      ], t('legend.nisar.more')));
      chipColors.push(lc.nisar.green);
    } else if (l.legend === 'rtc') {
      legendCard.append(h('div', { class: 'legend-block' },
        h('h3', { class: 'legend-title' }, t(l.name)),
        h('div', { class: 'ramp', style: `background: linear-gradient(90deg, ${lc.rtc.low}, ${lc.rtc.high})` }),
        h('p', { class: 'small' }, t('legend.rtc')),
      ));
    } else if (l.legend === 'jrc') {
      legendCard.append(legendBlock(t('legend.jrc.title'), [[lc.jrc.low, t('legend.jrc.low')], [lc.jrc.high, t('legend.jrc.high')]]));
    } else if (l.legend === 'sat') {
      legendCard.append(h('div', { class: 'legend-block' }, h('h3', { class: 'legend-title' }, t('legend.sat.title')), h('p', { class: 'small' }, t('legend.sat.body'))));
    } else if (l.kind === 'db') {
      legendCard.append(h('div', { class: 'legend-block' },
        h('h3', { class: 'legend-title' }, t(l.name)),
        h('div', { class: 'ramp', style: `background: linear-gradient(90deg, ${lc.db.low}, ${lc.db.high})` }),
        h('p', { class: 'small' }, t(s.area === 'kedah' ? 'legend.ked.db' : 'legend.db')),
        h('p', { class: 'muted small' }, t('legend.pending')),
      ));
    }
  }
  if (s.mode === 'expert' && !imageryOnly(a)) {
    legendCard.append(h('button', { class: 'link', onclick: () => S.set({ tab: 'sure', sheet: 'half', sureOpen: true }) }, t('legend.more')));
  }
  clear(legendChip);
  legendChip.append(...chipColors.slice(0, 3).map((c) => swatch([c])), h('span', {}, t('legend.chip')));
}

/** What the dock and legend actually show. Opacity is left out on purpose: re-rendering on every slider step
 *  replaced the slider being dragged, so the drag stopped after one step (bug fixed 12 Nov). */
function dockKey(s: S.State): string {
  const on = layersFor(s.area).map((l) => (s.layers[l.id]?.on ? '1' : '0')).join('');
  return `${s.area}|${s.base}|${s.mode}|${on}`;
}

export function initLeftCol(): void {
  renderTitle();
  renderLayers();
  renderLegend();
  let lastDock = dockKey(S.get());
  // The newest-NISAR row shows which pass it found; redraw the dock when that answer arrives.
  document.addEventListener('nisar-latest', () => renderLayers());
  S.subscribe((s, ch) => {
    if (['area', 'date', 'compare', 'mode'].some((k) => ch.has(k as keyof S.State))) renderTitle();
    const key = dockKey(s);
    if (key !== lastDock) {
      lastDock = key;
      renderLayers();
      renderLegend();
    }
  });
  void map;
}
