// F8 story mode: one card at a time over the live map, progress dots, Next/Back, "Skip to explore" always visible.
import { layersFor, story, type StoryStep } from '../config';
import { t } from '../i18n';
import { $, clear, h, storage } from '../lib/dom';
import * as S from '../state';
import { compareDefault } from '../map/compare';
import { flyTo } from '../map/mainMap';
import { switchArea } from './leftCol';
import { showHintOnce } from './mapInteract';
import { visited } from './kit';
import { applyWindow } from './windows';
import { togglePlay } from './timeControl';
import { openSure } from './topBar';

let appliedStep: number | null = null;

function applyStep(st: StoryStep): void {
  const layers = { ...S.get().layers };
  for (const l of layersFor(st.state.area)) {
    if (l.base) continue;
    layers[l.id] = { ...layers[l.id], on: st.state.layers[l.id] ?? l.id === 'districts' };
  }
  S.set({ area: st.state.area, date: st.state.date, base: st.state.base, compare: st.state.compare, layers, playing: false, district: null });
  flyTo(st.camera.center, st.camera.zoom);
}

function doAction(what: string): void {
  if (what === 'base-map') {
    const ls = S.get().layers;
    S.set({ base: 'map', layers: { ...ls, kel_dswx: { ...ls.kel_dswx, on: true } } });
  }
  else if (what === 'compare') S.set(compareDefault());
  else if (what === 'numbers') S.set({ tab: 'numbers', sheet: 'half' });
  else if (what === 'play') togglePlay(true);
  else if (what === 'sure') openSure();
  else if (what === 'explore') {
    finish();
    switchArea('explore');
  }
}

function finish(): void {
  storage.set('story-seen', '1');
  S.set({ step: null, compare: 'off' });
  showHintOnce();
}

function render(): void {
  const s = S.get();
  const root = $('#story-layer');
  document.body.classList.toggle('story-on', s.step !== null);
  clear(root);
  if (s.step === null) {
    appliedStep = null;
    return;
  }
  const i = Math.max(0, Math.min(story.steps.length - 1, s.step));
  const st = story.steps[i];
  visited.add('steps', String(i)); // F · objectives tracker
  if (appliedStep !== i) {
    appliedStep = i;
    applyStep(st);
  }
  const total = story.steps.length;
  // Progress as a path of nodes (skill-tree style in Deep Space); each node jumps to its step.
  const dots = h('ol', { class: 'dots node-path', 'aria-label': t('story.progress', { n: i + 1, total }) },
    story.steps.map((st, k) => h('li', { class: k === i ? 'is-current' : k < i ? 'is-done' : '' },
      h('button', {
        class: 'node', 'aria-label': `${k + 1}. ${t(st.title)}`, title: t(st.title), 'aria-current': k === i ? 'step' : null,
        onclick: () => S.set({ step: k, compare: 'off' }),
      }))));
  const last = i === total - 1;
  root.append(
    h('section', { class: 'card story-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'story-title' },
      h('div', { class: 'story-top' },
        h('span', { class: 'hud-label' }, t('story.progress', { n: i + 1, total })),
        dots,
        h('button', { class: 'link', onclick: finish }, t('story.skip')),
      ),
      st.bridge ? h('p', { class: 'story-bridge' }, t(st.bridge)) : null,
      h('h2', { class: 'story-title', id: 'story-title' }, t(st.title)),
      h('p', { class: 'story-body' }, t(st.body)),
      st.global ? h('p', { class: 'story-global' }, t(st.global)) : null,
      h('div', { class: 'story-actions' },
        st.action ? h('button', { class: 'pill pill-primary', onclick: () => doAction(st.action!.do) }, t(st.action.label)) : null,
        st.action2 ? h('button', { class: 'pill', onclick: () => doAction(st.action2!.do) }, t(st.action2.label)) : null,
      ),
      h('div', { class: 'story-nav' },
        h('button', { class: 'pill pill-quiet', disabled: i === 0, onclick: () => S.set({ step: i - 1, compare: 'off' }) }, t('story.back')),
        h('button', { class: 'pill pill-primary', onclick: () => (last ? finish() : S.set({ step: i + 1, compare: 'off' })) }, t(last ? 'story.done' : 'story.next')),
      ),
      st.footer ? h('p', { class: 'story-footer' }, t(st.footer)) : null,
    ),
  );
  applyWindow('story'); // the card is rebuilt every step: put it back where the user moved it
  (root.querySelector('.story-nav .pill-primary') as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

export function initStory(): void {
  const s = S.get();
  // First visit only: not when the address carries a view, the story was seen, or a saved view was restored.
  if (s.step === null && !location.search && !S.restoredView && !storage.get('story-seen')) S.set({ step: 0 });
  render();
  S.subscribe((st, ch) => {
    if (ch.has('step')) {
      document.body.classList.remove('story-show-panel');
      render();
    }
    // A story action (or the "How sure are we?" pill) that opens a tab brings the side panel back.
    if ((ch.has('tab') || ch.has('sureOpen')) && st.step !== null) document.body.classList.add('story-show-panel');
  });
}

export function storyActive(): boolean {
  return S.get().step !== null;
}

export function closeStory(): void {
  if (storyActive()) finish();
}
