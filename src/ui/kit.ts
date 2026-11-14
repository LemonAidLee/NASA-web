// Shared panel pieces for the game-menu style (added 12 Nov):
//  C  segBar: weapon-stat style segmented bar. Every bar states its basis (what 100% means) in its label.
//  A  inspectCard: header band + lore line + stats + sockets + key hints (pixel popup, marker preview).
//  B  districtSvg: a district's real DOSM outline as an SVG path.
//  F  visited: what the user has already seen (story steps, focus areas), for the objectives tracker.
import { t } from '../i18n';
import { h, storage } from '../lib/dom';
import { districtByCode } from '../map/districts';

export interface SegOpts {
  /** null = not measured yet (made at the event): hatched, empty. */
  value: number | null;
  max: number;
  /** Optional change drawn as a second, lighter shade after the value. */
  delta?: number;
  /** What the bar measures against, read by screen readers and shown on hover. */
  basis: string;
  n?: number;
}

export function segBar(o: SegOpts): HTMLElement {
  const n = o.n ?? 20;
  const pending = o.value === null;
  const filled = pending ? 0 : Math.round((Math.min(o.value as number, o.max) / o.max) * n);
  const withDelta = pending || !o.delta ? filled : Math.round((Math.min((o.value as number) + o.delta, o.max) / o.max) * n);
  const bar = h('span', { class: `segbar${pending ? ' is-pending' : ''}`, role: 'img', 'aria-label': pending ? `${t('seg.pending')}. ${o.basis}` : o.basis, title: o.basis });
  for (let i = 0; i < n; i++) bar.append(h('b', { class: i < filled ? 'f' : i < withDelta ? 'd' : '' }));
  return bar;
}

export function statRow(label: string, bar: HTMLElement, value: string, extra?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'stat-row' }, h('span', { class: 'stat-label' }, label), bar, h('span', { class: 'stat-val num' }, value, extra ?? null));
}

export interface InspectOpts {
  name: string;
  typeLeft: string;
  typeRight?: string;
  lore: string;
  stats?: HTMLElement[];
  sockets?: { abbr: string; name: string; on: boolean; pending: boolean }[];
  more?: HTMLElement | null;
  actions?: HTMLElement[];
  compact?: boolean;
}

export function inspectCard(o: InspectOpts): HTMLElement {
  return h('div', { class: `insp${o.compact ? ' insp-compact' : ''}` },
    h('div', { class: 'insp-band' },
      h('p', { class: 'insp-name' }, o.name),
      h('p', { class: 'insp-type' }, h('span', {}, o.typeLeft), o.typeRight ? h('span', {}, o.typeRight) : null),
    ),
    h('div', { class: 'insp-body' },
      h('p', { class: 'insp-lore' }, o.lore),
      o.stats?.length ? h('div', { class: 'insp-stats' }, o.stats) : null,
      o.sockets?.length
        ? h('div', { class: 'insp-sockets', 'aria-label': t('insp.layers') },
            h('span', { class: 'hud-label' }, t('insp.layers')),
            ...o.sockets.map((s) => h('span', { class: `sock${s.on ? ' on' : ''}${s.pending ? ' pend' : ''}`, title: s.pending ? `${s.name} · ${t('sock.pending')}` : s.name }, s.abbr)))
        : null,
      o.more ?? null,
    ),
    o.actions?.length ? h('div', { class: 'insp-foot' }, o.actions) : null,
  );
}

export function keyHint(key: string, label: string): HTMLElement {
  return h('span', { class: 'key-hint' }, h('kbd', {}, key), ' ', label);
}

/** Real DOSM outline of a district as an SVG (viewBox 0..100, north up, aspect kept). */
export function districtSvg(code: string, cls = 'district-svg'): SVGSVGElement | null {
  const d = districtByCode(code);
  if (!d) return null;
  const [w, s, e, n] = d.bbox;
  const kx = Math.cos(((s + n) / 2) * (Math.PI / 180)); // shrink longitude so the shape is not stretched
  const span = Math.max((e - w) * kx, n - s);
  const k = 90 / span;
  const ox = (100 - (e - w) * kx * k) / 2;
  const oy = (100 - (n - s) * k) / 2;
  const path = d.polys
    .map((poly) => 'M' + poly[0].map(([x, y]) => `${(ox + (x - w) * kx * k).toFixed(2)},${(oy + (n - y) * k).toFixed(2)}`).join('L') + 'Z')
    .join('');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

// ---------- visited (objectives tracker) ----------

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(storage.get(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export const visited = {
  steps: (): Set<string> => readSet('visited-steps'),
  focus: (): Set<string> => readSet('visited-focus'),
  add(kind: 'steps' | 'focus', id: string): void {
    const key = kind === 'steps' ? 'visited-steps' : 'visited-focus';
    const s = readSet(key);
    if (s.has(id)) return;
    s.add(id);
    storage.set(key, JSON.stringify([...s]));
    document.dispatchEvent(new CustomEvent('visited'));
  },
};
