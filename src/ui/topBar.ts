// F20 HUD status bar (expert), plain top bar (simple / mobile), menu, theme switch (F19), live catalogue check (F27).
import { area, imageryOnly, fmtDate, primaryPasses, provenance } from '../config';
import { lang, setLang, t } from '../i18n';
import { $, clear, h, storage } from '../lib/dom';
import { latestTime } from '../lib/catalog';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { resetLayout } from './windows';
import { savePicture } from './snapshot';

let latestPass: string | null = null;
let liveOk = false;
let clockTimer = 0;

const fmtClock = (tz: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz });
const myt = fmtClock('Asia/Kuala_Lumpur');
const utc = fmtClock('UTC');

export function nextTheme(): void {
  const s = S.get();
  const i = S.THEMES.indexOf(s.theme);
  const theme = S.THEMES[(i + 1) % S.THEMES.length];
  storage.set('theme', theme);
  S.set({ theme });
}

export function toggleMode(): void {
  const mode = S.get().mode === 'expert' ? 'simple' : 'expert';
  storage.set('mode', mode);
  S.set({ mode });
}

export function openSure(): void {
  S.set({ tab: 'sure', panelOpen: true, sheet: 'half' });
  if (S.get().step !== null) document.body.classList.add('story-show-panel');
  window.setTimeout(() => document.getElementById('sure-card')?.focus(), 50);
}

function seg(label: string, value: string, cls = ''): HTMLElement {
  return h('span', { class: `hud-seg ${cls}` }, h('span', { class: 'hud-label' }, label), ' ', h('span', { class: 'hud-value' }, value));
}

function render(): void {
  const s = S.get();
  const a = area(s.area);
  const bar = $('#topbar');
  clear(bar);
  const pass = primaryPasses(s.area).find((p) => p.date_myt === s.date);
  const dateLabel = `${fmtDate(s.date)}${pass ? ` ${pass.time_myt}` : ''}`;

  // ---- desktop bar: only what a reader needs at a glance (14 Nov declutter) ----
  // Clocks, layer and scene counts, radar age and the data status moved out: the time bar, the rails and
  // "How sure are we?" carry them.
  const expert = h(
    'div',
    { class: 'hud-row x-only' },
    h('span', { class: 'hud-path' }, t('app.title')),
    seg(t('hud.area'), t(a.short)),
    seg(t('hud.date'), dateLabel),
    latestPass
      ? h('span', { class: `hud-seg hud-live${liveOk ? ' is-live' : ''}`, title: t(liveOk ? 'hud.live.tip' : 'hud.archive.tip') },
          h('span', { class: 'hud-dot', 'aria-hidden': 'true' }), ' ', t(liveOk ? 'hud.latest.live' : 'hud.latest.saved', { date: fmtDate(latestPass) }))
      : null,
    h('span', { class: 'hud-spacer' }),
    h('div', { class: 'segmented', role: 'group', 'aria-label': `${t('hud.map')} / ${t('hud.sat')}` },
      h('button', { class: 'pill pill-sm', 'aria-pressed': String(s.base === 'map'), onclick: () => S.set({ base: 'map' }) }, t('hud.map').toUpperCase()),
      h('button', { class: 'pill pill-sm', 'aria-pressed': String(s.base === 'sat'), onclick: () => S.set({ base: 'sat' }) }, t('hud.sat').toUpperCase()),
    ),
    h('button', { class: 'pill pill-sm', 'aria-label': `${t('hud.theme')}: ${t(`theme.${s.theme}`)}`, title: t(`theme.${s.theme}`), onclick: nextTheme }, '◐'),
    h('button', { class: 'pill pill-sm', 'aria-label': t('hud.help'), onclick: () => document.dispatchEvent(new CustomEvent('help')) }, '?'),
    langPill(),
    surePill(),
    menuButton(),
  );

  // ---- simple / mobile bar ----
  const simple = h(
    'div',
    { class: 'hud-row s-only' },
    h('span', { class: 'app-title' }, t('app.title')),
    h('span', { class: 'top-where' }, `${t(a.short)} · ${fmtDate(s.date)}`),
    a.kind === 'live' ? h('span', { class: 'chip chip-live' }, t('hud.live')) : h('span', { class: 'chip chip-past' }, t('hud.past')),
    h('span', { class: 'hud-spacer' }),
    a.kind !== 'explore'
      ? h('button', { class: 'pill pill-sm desktop-only', 'aria-pressed': String(s.base === 'sat'), onclick: () => S.set({ base: s.base === 'sat' ? 'map' : 'sat' }) }, t('hud.satbtn'))
      : null,
    langPill(),
    surePill(),
    menuButton(),
  );
  bar.append(expert, simple);
  tick();
}

/** BM / EN switch: shows the other language's short name, so a Malay speaker sees "BM" on the English page. */
function langPill(): HTMLElement {
  const other = lang === 'ms' ? 'en' : 'ms';
  return h('button', { class: 'pill pill-sm pill-lang', lang: other, 'aria-label': t('lang.switch'), title: t('lang.switch'), onclick: () => setLang(other) }, other === 'ms' ? 'BM' : 'EN');
}

function surePill(): HTMLElement {
  // The full question on wide screens; a short form on phones, where the Malay wording would push the menu off screen.
  return h('button', { class: 'pill pill-sure', 'aria-label': t('sure.pill'), onclick: openSure }, h('span', { 'aria-hidden': 'true' }, 'ⓘ'), ' ',
    h('span', { class: 'sure-long', 'aria-hidden': 'true' }, t('sure.pill')), h('span', { class: 'sure-short', 'aria-hidden': 'true' }, t('sure.pill.short')));
}

function menuButton(): HTMLElement {
  return h('button', { class: 'pill pill-sm pill-menu', 'aria-haspopup': 'true', 'aria-label': t('hud.menu'), onclick: openMenu }, '☰');
}

function openMenu(): void {
  const root = $('#overlay-root');
  const s = S.get();
  const closeMenu = () => {
    root.querySelector('.menu')?.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
  closeMenu();
  const item = (label: string, fn: () => void) =>
    h('li', {}, h('button', { class: 'menu-item', onclick: () => { closeMenu(); fn(); } }, label));
  const menu = h(
    'div',
    { class: 'menu card', role: 'dialog', 'aria-label': t('hud.menu') },
    h('ul', {},
      item(s.mode === 'expert' ? t('menu.expert.off') : t('menu.expert.on'), toggleMode),
      item(t('menu.story'), () => S.set({ step: 0 })),
      item(t('menu.theme', { name: t(`theme.${s.theme}`) }), nextTheme),
      item(t('lang.switch'), () => setLang(lang === 'ms' ? 'en' : 'ms')),
      !imageryOnly(area(s.area)) ? item(t('compare.open'), () => S.set(compareDefault())) : null,
      item(t('snap.menu'), () => void savePicture()),
      item(t('menu.copy'), () => {
        navigator.clipboard?.writeText(location.href).catch(() => undefined);
        document.dispatchEvent(new CustomEvent('toast', { detail: t('menu.copied') }));
      }),
      item(t('menu.credits'), () => S.set({ tab: 'about', sheet: 'half' })),
      window.matchMedia('(pointer: coarse)').matches ? null : item(t('menu.shortcuts'), () => document.dispatchEvent(new CustomEvent('help'))), // no keyboard on touch screens
      window.matchMedia('(max-width: 767px)').matches ? null : item(t('win.reset'), resetLayout),
      item(t('menu.resetview'), S.resetView),
    ),
    h('button', { class: 'pill pill-quiet', onclick: closeMenu }, t('menu.close')),
  );
  root.append(menu);
  document.addEventListener('keydown', onKey);
  (menu.querySelector('button') as HTMLButtonElement)?.focus();
}

function tick(): void {
  const now = new Date();
  const a = document.getElementById('clock-myt');
  const b = document.getElementById('clock-utc');
  if (a) a.textContent = myt.format(now);
  if (b) b.textContent = utc.format(now);
}

/** F27: CMR search of both NISAR GCOV collections (validated from 21 Oct 2026, provisional before), no login.
 *  Falls back to the date in provenance.json and MODE ARCHIVE. */
async function liveCheck(areaId: string): Promise<void> {
  const a = area(areaId);
  latestPass = provenance.latest_nisar_baked[areaId] ?? provenance.latest_nisar_baked[a.outline ?? ''] ?? null;
  liveOk = false;
  if (a.kind === 'explore') return;
  try {
    const ts = await latestTime('nisar_gcov', a.bbox);
    if (ts) {
      latestPass = ts.slice(0, 10);
      liveOk = true;
    }
  } catch {
    /* offline or blocked: archive mode */
  }
  if (S.get().area === areaId) render();
}

export function initTopBar(): void {
  render();
  S.subscribe((s, ch) => {
    if (['area', 'date', 'layers', 'base', 'theme', 'mode'].some((k) => ch.has(k as keyof S.State))) render();
    if (ch.has('area')) void liveCheck(s.area);
  });
  void liveCheck(S.get().area);
  const loop = () => {
    window.clearInterval(clockTimer);
    if (!document.hidden) clockTimer = window.setInterval(tick, 1000);
  };
  document.addEventListener('visibilitychange', loop);
  loop();
}
