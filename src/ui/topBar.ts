// F20 HUD status bar (expert), plain top bar (simple / mobile), menu, theme switch (F19), live catalogue check (F27).
import { area, imageryOnly, fmtDate, layersFor, passesFor, primaryPasses, provenance, resolveDate } from '../config';
import { t } from '../i18n';
import { $, clear, h, storage } from '../lib/dom';
import { latestTime } from '../lib/catalog';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { resetLayout } from './windows';

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
  S.set({ tab: 'sure', sheet: 'half' });
  if (S.get().step !== null) document.body.classList.add('story-show-panel');
  window.setTimeout(() => document.getElementById('sure-card')?.focus(), 50);
}

function seg(label: string, value: string, cls = ''): HTMLElement {
  return h('span', { class: `hud-seg ${cls}` }, h('span', { class: 'hud-label' }, label), ' ', h('span', { class: 'hud-value' }, value));
}

function radarAge(s: S.State): number | null {
  const main = layersFor(s.area).find((l) => l.dates === 'passes');
  if (!main) return null;
  const r = resolveDate(main, s.area, s.date);
  return r ? Math.abs(r.age) : null;
}

function render(): void {
  const s = S.get();
  const a = area(s.area);
  const bar = $('#topbar');
  clear(bar);
  const pass = primaryPasses(s.area).find((p) => p.date_myt === s.date);
  const dateLabel = `${fmtDate(s.date)}${pass ? ` ${pass.time_myt}` : ''}`;

  // ---- expert HUD ----
  const visible = layersFor(s.area).filter((l) => !l.expert_only || s.mode === 'expert');
  const onCount = visible.filter((l) => (l.base ? s.base === 'sat' || s.layers[l.id]?.on : s.layers[l.id]?.on)).length;
  const scenes = passesFor(s.area).length;
  const age = radarAge(s);
  const expert = h(
    'div',
    { class: 'hud-row x-only' },
    h('span', { class: 'hud-path' }, t('app.path')),
    h('span', { class: 'hud-seg hud-clock' }, h('span', { class: 'hud-label' }, t('hud.myt')), ' ', h('span', { class: 'hud-value', id: 'clock-myt' }, '--:--:--'),
      ' · ', h('span', { class: 'hud-label' }, t('hud.utc')), ' ', h('span', { class: 'hud-value', id: 'clock-utc' }, '--:--:--'), h('span', { class: 'hud-value' }, 'Z')),
    seg(t('hud.area'), t(a.short).toUpperCase()),
    seg(t('hud.date'), dateLabel.toUpperCase()),
    !imageryOnly(a) && age !== null ? seg(t('hud.age'), `${age} D`, age > 6 ? 'hud-muted' : '') : null,
    seg(t('hud.layers'), `${onCount}/${visible.length}`),
    !imageryOnly(a) ? seg(t('hud.scenes'), String(scenes)) : null,
    h('button', { class: 'hud-seg hud-btn', onclick: openSure, 'aria-label': t('sure.pill') },
      h('span', { class: 'hud-label' }, t('hud.data')), ' ', h('span', { class: 'hud-value' }, `● ${t('hud.provisional').toUpperCase()}`)),
    seg(t('hud.mode'), liveOk ? t('hud.livecheck').toUpperCase() : t('hud.archive').toUpperCase()),
    latestPass ? seg(t('hud.latest'), fmtDate(latestPass).toUpperCase()) : null,
    h('span', { class: 'hud-spacer' }),
    h('div', { class: 'segmented', role: 'group', 'aria-label': `${t('hud.map')} / ${t('hud.sat')}` },
      h('button', { class: 'pill pill-sm', 'aria-pressed': String(s.base === 'map'), onclick: () => S.set({ base: 'map' }) }, t('hud.map').toUpperCase()),
      h('button', { class: 'pill pill-sm', 'aria-pressed': String(s.base === 'sat'), onclick: () => S.set({ base: 'sat' }) }, t('hud.sat').toUpperCase()),
    ),
    h('button', { class: 'pill pill-sm', 'aria-label': `${t('hud.theme')}: ${t(`theme.${s.theme}`)}`, title: t(`theme.${s.theme}`), onclick: nextTheme }, '◐'),
    h('button', { class: 'pill pill-sm', 'aria-label': t('hud.help'), onclick: () => document.dispatchEvent(new CustomEvent('help')) }, '?'),
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
    surePill(),
    menuButton(),
  );
  bar.append(expert, simple);
  tick();
}

function surePill(): HTMLElement {
  return h('button', { class: 'pill pill-sure', onclick: openSure }, h('span', { 'aria-hidden': 'true' }, 'ⓘ'), ' ', t('sure.pill'));
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
      !imageryOnly(area(s.area)) ? item(t('compare.open'), () => S.set(compareDefault())) : null,
      item(t('menu.copy'), () => {
        navigator.clipboard?.writeText(location.href).catch(() => undefined);
        document.dispatchEvent(new CustomEvent('toast', { detail: t('menu.copied') }));
      }),
      item(t('menu.credits'), () => S.set({ tab: 'about', sheet: 'half' })),
      item(t('menu.shortcuts'), () => document.dispatchEvent(new CustomEvent('help'))),
      window.matchMedia('(max-width: 767px)').matches ? null : item(t('win.reset'), resetLayout),
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
