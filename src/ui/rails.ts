// Desktop icon rails: a slim vertical bar on each edge of the map. Every panel can be minimised to its icon and
// reopened from it; hovering (or focusing) an icon shows its name and a one-line description.
//   Left rail  → panels in the left column: Place, Layers, Legend (any combination can be open).
//   Right rail → the side panel's sections (one at a time), then the AI analysis and the objectives list.
// Phones keep the bottom sheet; the rails are desktop only (styles/rails.css).
import { area, focusFor, imageryOnly } from '../config';
import { t } from '../i18n';
import { $, clear, h } from '../lib/dom';
import * as S from '../state';
import { openFocus } from './focus';

// ---------- icons: simple 24 px stroke drawings (own artwork, static markup) ----------

const ICONS: Record<string, string> = {
  place: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  legend: '<rect x="4" y="5" width="4" height="4" rx="1"/><rect x="4" y="14" width="4" height="4" rx="1"/><path d="M11 7h9M11 16h9"/>',
  numbers: '<path d="M4 20h16"/><path d="M7 16V11M12 16V6M17 16v-3"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 14H7z"/><path d="m8 17-1 3M12 17l-1 3M16 17l-1 3"/>',
  sure: '<path d="M12 3 5 6v5c0 4.6 3 8.5 7 10 4-1.5 7-5.4 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
  story: '<path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5V5.5z"/><path d="M12 6v13.5"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.6v.4"/>',
  ai: '<path d="M12 3c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5C9.7 8.9 11.4 7.2 12 3z"/><path d="M18 15.5c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8z"/>',
  objectives: '<path d="M5 21V4"/><path d="M5 4h11l-2 3.5L16 11H5"/>',
  minimise: '<path d="M6 12h12"/>',
};

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'rail-icon');
  svg.innerHTML = ICONS[name] ?? ''; // static, trusted markup from this file only
  return svg;
}

// ---------- rail items ----------

interface Item {
  id: string;
  icon: string;
  label: (s: S.State) => string;
  desc: (s: S.State) => string;
  on: (s: S.State) => boolean;
  toggle: (s: S.State) => void;
  show?: (s: S.State) => boolean;
}

const toggleLeft = (id: string) => (s: S.State) =>
  S.set({ leftPanels: s.leftPanels.includes(id) ? s.leftPanels.filter((x) => x !== id) : [...s.leftPanels, id] });

const tabOn = (id: string) => (s: S.State) => s.panelOpen && activeTab(s) === id;
const toggleTab = (id: string) => (s: S.State) =>
  S.set(tabOn(id)(s) ? { panelOpen: false } : { tab: id, panelOpen: true, sheet: s.sheet === 'peek' ? 'half' : s.sheet });

/** The side-panel section shown on desktop (mirrors ui/panel.ts). */
export function activeTab(s: S.State): string {
  const allowed = deskTabs(s);
  return allowed.includes(s.tab) ? s.tab : allowed[0];
}
export function deskTabs(s: S.State): string[] {
  return imageryOnly(area(s.area)) ? ['numbers', 'sure', 'story', 'about'] : ['numbers', 'rain', 'sure', 'story', 'about'];
}

const LEFT: Item[] = [
  { id: 'place', icon: 'place', label: () => t('rail.place'), desc: () => t('rail.place.desc'), on: (s) => s.leftPanels.includes('place'), toggle: toggleLeft('place') },
  { id: 'layers', icon: 'layers', label: () => t('rail.layers'), desc: () => t('rail.layers.desc'), on: (s) => s.leftPanels.includes('layers'), toggle: toggleLeft('layers') },
  { id: 'legend', icon: 'legend', label: () => t('rail.legend'), desc: () => t('rail.legend.desc'), on: (s) => s.leftPanels.includes('legend'), toggle: toggleLeft('legend') },
];

const RIGHT: Item[] = [
  {
    id: 'numbers', icon: 'numbers',
    label: (s) => t(area(s.area).kind === 'live' ? 'rail.numbers.live' : imageryOnly(area(s.area)) ? 'rail.numbers.exp' : 'rail.numbers'),
    desc: (s) => t(s.area === 'kedah' ? 'rail.numbers.desc.ked' : s.area === 'kelantan' ? 'rail.numbers.desc.kel' : 'rail.numbers.desc.exp'),
    on: tabOn('numbers'), toggle: toggleTab('numbers'),
  },
  { id: 'rain', icon: 'rain', label: () => t('rail.rain'), desc: () => t('rail.rain.desc'), on: tabOn('rain'), toggle: toggleTab('rain'), show: (s) => !imageryOnly(area(s.area)) },
  { id: 'sure', icon: 'sure', label: () => t('rail.sure'), desc: () => t('rail.sure.desc'), on: tabOn('sure'), toggle: toggleTab('sure') },
  { id: 'story', icon: 'story', label: () => t('rail.story'), desc: () => t('rail.story.desc'), on: tabOn('story'), toggle: toggleTab('story') },
  { id: 'about', icon: 'about', label: () => t('rail.about'), desc: () => t('rail.about.desc'), on: tabOn('about'), toggle: toggleTab('about') },
];

const EXTRA: Item[] = [
  {
    id: 'ai', icon: 'ai', label: () => t('rail.ai'), desc: () => t('rail.ai.desc'),
    on: (s) => s.dash !== 'closed' && !!s.focus,
    toggle: (s) => {
      if (s.dash !== 'closed' && s.focus) S.set({ dash: 'closed' });
      else {
        const list = focusFor(s.area);
        const f = list.find((x) => x.id === s.focus) ?? list[0];
        if (f) openFocus(f.id);
      }
    },
    show: (s) => focusFor(s.area).length > 0,
  },
  {
    id: 'objectives', icon: 'objectives', label: () => t('rail.objectives'), desc: () => t('rail.objectives.desc'),
    on: (s) => s.trackerOpen, toggle: (s) => S.set({ trackerOpen: !s.trackerOpen }),
    show: (s) => !imageryOnly(area(s.area)),
  },
];

const leftRail = h('nav', { class: 'rail rail-left', 'aria-label': 'Left panels' });
const rightRail = h('nav', { class: 'rail rail-right', 'aria-label': 'Side panel and tools' });

function button(it: Item, s: S.State, side: 'left' | 'right'): HTMLElement {
  const on = it.on(s);
  const tipId = `rail-tip-${it.id}`;
  return h('button', {
    class: `rail-btn${on ? ' is-on' : ''}`, type: 'button',
    'aria-pressed': String(on), 'aria-label': it.label(s), 'aria-describedby': tipId,
    'data-side': side,
    onclick: () => it.toggle(S.get()),
  }, icon(it.icon),
  h('span', { class: 'rail-tip', id: tipId, role: 'tooltip' }, h('strong', {}, it.label(s)), h('span', {}, it.desc(s)), h('em', {}, t(on ? 'rail.hide' : 'rail.show'))));
}

function render(): void {
  const s = S.get();
  clear(leftRail);
  clear(rightRail);
  leftRail.append(...LEFT.map((it) => button(it, s, 'left')));
  rightRail.append(...RIGHT.filter((it) => !it.show || it.show(s)).map((it) => button(it, s, 'right')));
  const extra = EXTRA.filter((it) => !it.show || it.show(s));
  if (extra.length) rightRail.append(h('span', { class: 'rail-sep', 'aria-hidden': 'true' }), ...extra.map((it) => button(it, s, 'right')));
  // Let the rest of the layout (dashboard, objectives, compare labels, map padding) know what is open on each side.
  const root = document.documentElement;
  root.dataset.left = s.leftPanels.length ? 'open' : 'closed';
  root.dataset.right = s.panelOpen ? 'open' : 'closed';
  for (const id of ['place', 'layers', 'legend']) {
    const el = document.getElementById(id === 'place' ? 'titlecard' : id === 'layers' ? 'layers-card' : 'legend-card');
    el?.classList.toggle('is-minimised', !s.leftPanels.includes(id));
  }
  document.getElementById('panel')?.classList.toggle('is-minimised', !s.panelOpen);
}

/** "–" button in a panel's corner: minimise it to its rail icon. */
export function minimiseButton(target: 'place' | 'layers' | 'legend' | 'panel'): HTMLElement {
  const label = t('rail.minimise', { name: t(target === 'panel' ? 'rail.panel' : `rail.${target}`) });
  return h('button', {
    class: 'card-min', type: 'button', 'aria-label': label, title: label,
    onclick: () => {
      const s = S.get();
      if (target === 'panel') S.set({ panelOpen: false });
      else S.set({ leftPanels: s.leftPanels.filter((x) => x !== target) });
    },
  }, icon('minimise'));
}

export function initRails(): void {
  const stage = $('#stage');
  stage.append(leftRail, rightRail);
  render();
  S.subscribe((_s, ch) => {
    if (['leftPanels', 'panelOpen', 'tab', 'dash', 'focus', 'trackerOpen', 'area', 'step', 'compare', 'mode'].some((k) => ch.has(k as keyof S.State))) render();
  });
}
