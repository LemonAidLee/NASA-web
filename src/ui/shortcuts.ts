// F25 keyboard shortcuts + "?" help card.
import { area, studyBbox } from '../config';
import { t } from '../i18n';
import { $, h } from '../lib/dom';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { fitArea } from '../map/mainMap';
import { closePopups } from './mapInteract';
import { closeStory } from './story';
import { cycleTab } from './panel';
import { closeDash, dashOpen } from './focus';
import { step, togglePlay } from './timeControl';
import { nextTheme } from './topBar';

const KEYS: [string, string][] = [
  ['Space', 'help.space'],
  ['← →', 'help.arrows'],
  ['L', 'help.l'],
  ['S', 'help.s'],
  ['P', 'help.p'],
  ['B', 'help.b'],
  ['T', 'help.t'],
  ['F', 'help.f'],
  ['R', 'help.r'],
  ['Esc', 'help.esc'],
  ['Q / E', 'help.qe'],
  ['Alt + ←↑↓→', 'help.altmove'],
  ['Alt + Shift + ←↑↓→', 'help.altsize'],
  ['?', 'help.q'],
];

function openHelp(): void {
  const root = $('#overlay-root');
  if (root.querySelector('.help')) return;
  const close = () => root.querySelector('.help')?.remove();
  const dlg = h('div', { class: 'help card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' },
    h('h2', { class: 'card-title', id: 'help-title' }, t('help.title')),
    h('dl', { class: 'keys' }, KEYS.map(([k, v]) => h('div', { class: 'kv' }, h('dt', {}, h('kbd', {}, k)), h('dd', {}, t(v))))),
    h('p', { class: 'small muted' }, t('help.win')),
    h('button', { class: 'pill', onclick: close }, t('help.close')),
  );
  root.append(dlg);
  (dlg.querySelector('button') as HTMLButtonElement).focus();
}

function closeAll(): boolean {
  const root = $('#overlay-root');
  const open = root.querySelector('.help, .menu');
  if (open) {
    open.remove();
    return true;
  }
  const s = S.get();
  if (dashOpen()) {
    closeDash();
    return true;
  }
  if (s.compare !== 'off') {
    S.set({ compare: 'off' });
    return true;
  }
  if (s.step !== null) {
    closeStory();
    return true;
  }
  if (s.district) {
    S.set({ district: null });
    return true;
  }
  if (s.sheet !== 'peek') {
    S.set({ sheet: 'peek' });
    return true;
  }
  closePopups();
  return false;
}

export function initShortcuts(): void {
  document.addEventListener('help', openHelp);
  document.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, select, textarea, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = S.get();
    const k = e.key;
    if (k === 'Escape') {
      closeAll();
      return;
    }
    // Arrow keys pan the map when it has focus (WCAG 2.5.7 alternative to dragging).
    const onMap = tgt.closest('#map') !== null;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !onMap && !tgt.closest('[role=tablist]')) {
      step(k === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      return;
    }
    if (tgt.closest('button, a') && (k === ' ' || k === 'Enter')) return;
    switch (k.toLowerCase()) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'l':
        S.set({ dockOpen: !s.dockOpen });
        break;
      case 's':
        if (area(s.area).kind !== 'explore') S.set(s.compare === 'dates' ? { compare: 'off' } : compareDefault());
        break;
      case 'p':
        if (s.area === 'kedah') S.set({ compare: s.compare === 'pol' ? 'off' : 'pol' });
        break;
      case 'b':
        S.set({ base: s.base === 'sat' ? 'map' : 'sat' });
        break;
      case 't':
        nextTheme();
        break;
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        break;
      case 'q':
        cycleTab(-1);
        break;
      case 'e':
        cycleTab(1);
        break;
      case 'r':
        fitArea(studyBbox(s.area));
        break;
      case '?':
        openHelp();
        break;
      default:
        return;
    }
  });
}
