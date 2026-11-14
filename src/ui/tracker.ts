// F · objectives tracker: a small, collapsible quest-style list in the map's top-right for the story and the
// focus-area tour. Ticks itself off from what the user has actually seen (kit.visited). Hidden on phones, during the
// story itself, in compare mode and behind the expanded dashboard.
import { area, imageryOnly, focusFor, story } from '../config';
import { t } from '../i18n';
import { $, clear, h, storage } from '../lib/dom';
import * as S from '../state';
import { openFocus } from './focus';
import { visited } from './kit';

const el = h('aside', { class: 'tracker', 'aria-label': t('trk.title') });

function collapsed(): boolean {
  return storage.get('tracker-collapsed') === '1';
}

function render(): void {
  const s = S.get();
  const list = focusFor(s.area);
  clear(el);
  el.hidden = s.step !== null || s.compare !== 'off' || s.dash === 'max' || imageryOnly(area(s.area));
  if (el.hidden) return;
  const isCollapsed = collapsed();
  el.append(h('button', {
    class: 'trk-toggle', 'aria-expanded': String(!isCollapsed), title: t(isCollapsed ? 'trk.show' : 'trk.hide'),
    onclick: () => { storage.set('tracker-collapsed', isCollapsed ? '0' : '1'); render(); },
  }, h('span', { class: 'hud-label' }, t('trk.title')), h('span', { class: 'trk-caret', 'aria-hidden': 'true' }, isCollapsed ? '▸' : '▾')));
  if (isCollapsed) return;

  // Story
  const seen = visited.steps();
  const total = story.steps.length;
  const done = story.steps.filter((_, k) => seen.has(String(k))).length;
  const next = story.steps.findIndex((_, k) => !seen.has(String(k)));
  el.append(h('section', { class: 'trk' },
    h('p', { class: 'trk-title' }, h('span', {}, t('trk.story')), h('span', { class: 'num' }, `${done}/${total}`)),
    next < 0
      ? h('p', { class: 'obj done' }, h('span', { class: 'chk done', 'aria-hidden': 'true' }), h('span', {}, t('trk.done')))
      : h('button', { class: 'obj', onclick: () => S.set({ step: next }) },
          h('span', { class: 'chk', 'aria-hidden': 'true' }), h('span', {}, done === 0 ? t('trk.start') : t('trk.next', { title: t(story.steps[next].title) }))),
    h('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, h('i', { style: `width:${(done / total) * 100}%` })),
  ));

  // Focus tour for this area
  if (list.length) {
    const vf = visited.focus();
    const n = list.filter((f) => vf.has(f.id)).length;
    el.append(h('section', { class: 'trk' },
      h('p', { class: 'trk-title' }, h('span', {}, t('trk.tour', { area: t(area(s.area).short) })), h('span', { class: 'num' }, `${n}/${list.length}`)),
      ...list.map((f) => {
        const isDone = vf.has(f.id);
        return h('button', { class: `obj${isDone ? ' done' : ''}`, onclick: () => openFocus(f.id) },
          h('span', { class: `chk${isDone ? ' done' : ''}`, 'aria-hidden': 'true' }), h('span', {}, `${f.district} · ${f.title}`));
      }),
      h('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(n) }, h('i', { style: `width:${(n / list.length) * 100}%` })),
    ));
  }
}

export function initTracker(): void {
  $('#stage').append(el);
  render();
  document.addEventListener('visited', render);
  S.subscribe((_s, ch) => {
    if (['area', 'step', 'compare', 'dash', 'focus'].some((k) => ch.has(k as keyof S.State))) render();
  });
}
