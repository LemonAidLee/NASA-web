// F12 layout: desktop columns vs mobile bottom sheet (peek holds the time control; half/full hold at most 4 tabs).
import { area, imageryOnly, fmtDate } from '../config';
import { t } from '../i18n';
import { $, clear, h } from '../lib/dom';
import * as S from '../state';
import { map } from '../map/mainMap';
import { layersCard, legendCard, legendChip, titleCard } from './leftCol';
import { sheetPopup } from './mapInteract';
import { panelRoot, setPanelMobile } from './panel';
import { timeControl } from './timeControl';
import { applyWindow } from './windows';

const mq = window.matchMedia('(max-width: 767px)');
const sheetHead = h('div', { class: 'sheet-head' });
const sheetPeekLine = h('p', { class: 'peek-line' });
const sheetBody = h('div', { class: 'sheet-body' });

function cycleSheet(): void {
  const order: S.Sheet[] = ['peek', 'half', 'full'];
  const s = S.get().sheet;
  S.set({ sheet: order[(order.indexOf(s) + 1) % order.length] });
}

function buildSheet(): void {
  const sheet = $('#sheet');
  clear(sheet);
  clear(sheetHead);
  sheetHead.append(
    h('button', { class: 'sheet-handle', 'aria-label': t('tab.list'), onclick: cycleSheet }, h('span', { 'aria-hidden': 'true' })),
    h('button', { class: 'pill pill-sm pill-quiet sheet-hide', onclick: () => S.set({ sheet: 'peek' }) }, '▾'),
  );
  sheet.append(sheetHead, sheetPeekLine, sheetPopup, sheetBody);
}

function placeNodes(): void {
  const mobile = mq.matches;
  document.documentElement.dataset.layout = mobile ? 'mobile' : 'desktop';
  const left = $('#leftcol');
  const timebar = $('#timebar');
  const panel = $('#panel');
  if (mobile) {
    clear(left);
    if (!sheetBody.contains(panelRoot)) sheetBody.append(panelRoot);
    if (!$('#sheet').contains(timeControl)) $('#sheet').insertBefore(timeControl, sheetPeekLine);
    if (!$('#stage').contains(legendChip)) $('#stage').append(legendChip);
  } else {
    // Cards the user dragged out of the column stay floating (ui/windows.ts).
    for (const c of [titleCard, layersCard, legendCard]) if (!c.classList.contains('is-floating')) left.append(c);
    for (const id of ['titlecard', 'layers-card', 'legend-card', 'panel']) applyWindow(id);
    if (!panel.contains(panelRoot)) panel.append(panelRoot);
    if (!timebar.contains(timeControl)) timebar.append(timeControl);
    legendChip.remove();
  }
  setPanelMobile(mobile);
  // Forced simple mode on phones (F12 cut order item 1), unless the URL asks for expert.
  if (mobile && S.get().mode === 'expert' && !new URLSearchParams(location.search).has('mode')) S.set({ mode: 'simple' });
  window.setTimeout(() => map?.resize(), 50);
}

function applySheet(s: S.State): void {
  const sheet = $('#sheet');
  sheet.dataset.state = s.sheet;
  // Collapsed content is inert so focus never lands under it (WCAG 2.4.11).
  if (s.sheet === 'peek') sheetBody.setAttribute('inert', '');
  else sheetBody.removeAttribute('inert');
}

function peekLine(s: S.State): void {
  const a = area(s.area);
  sheetPeekLine.textContent = imageryOnly(a) ? t('exp.badge') : t(a.panel.headline, { date: fmtDate(s.date) });
}

export function initLayout(): void {
  buildSheet();
  placeNodes();
  new ResizeObserver(([e]) => {
    document.documentElement.style.setProperty('--peek-h', `${Math.round(e.contentRect.height)}px`);
  }).observe($('#sheet'));
  mq.addEventListener('change', placeNodes);
  const s = S.get();
  applySheet(s);
  peekLine(s);
  S.subscribe((st, ch) => {
    if (ch.has('sheet')) applySheet(st);
    if (ch.has('area') || ch.has('date')) peekLine(st);
    if (ch.has('dockOpen')) document.body.classList.toggle('dock-closed', !st.dockOpen);
    if (ch.has('tab') && mq.matches && st.sheet === 'peek') S.set({ sheet: 'half' });
  });
}
