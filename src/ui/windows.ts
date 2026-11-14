// Movable, resizable panels (desktop only, added 12 Nov).
//  · Move: drag a panel by its top edge (the edge highlights; the cursor becomes a grab hand). Left-column cards
//    pop out of the column and float when dragged.
//  · Resize: the browser's own corner resizer (CSS resize), bottom-right. Docked left cards resize in height only.
//  · Keyboard: with focus inside a panel, Alt+arrows move it, Alt+Shift+arrows resize it.
//  · Reset: double-click a panel's top edge, or "Reset panel layout" in the menu.
//  · Positions and sizes are saved per panel in localStorage and always kept inside the map area.
// Phones keep the bottom-sheet layout: nothing here runs below 768 px.
import { t } from '../i18n';
import { $, announce, storage } from '../lib/dom';

const GRIP = 30; // px: the draggable strip at the top of each panel
const KEEP = 60; // px of a panel that must stay inside the map area
const mq = window.matchMedia('(max-width: 767px)');
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="tab"], [tabindex]:not([tabindex="-1"]), .maplibregl-canvas';

interface Win {
  id: string;
  el: () => HTMLElement | null;
  /** Left-column cards: docked in the column until dragged, then floating in #stage. */
  dock?: { column: () => HTMLElement; order: string[] };
}

interface Saved { x?: number; y?: number; w?: number; h?: number; floating?: boolean }

const wins: Win[] = [];

function key(id: string): string {
  return `win:${id}`;
}
function load(id: string): Saved | null {
  try {
    return JSON.parse(storage.get(key(id)) ?? 'null') as Saved | null;
  } catch {
    return null;
  }
}
function save(id: string, s: Saved): void {
  storage.set(key(id), JSON.stringify(s));
}

function stage(): HTMLElement {
  return $('#stage');
}

function clamp(el: HTMLElement): void {
  const st = stage().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let x = r.left - st.left;
  let y = r.top - st.top;
  x = Math.min(Math.max(x, KEEP - r.width), st.width - KEEP);
  y = Math.min(Math.max(y, 0), st.height - GRIP);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

/** Turn a CSS-positioned panel into one positioned by left/top/width/height (inline). */
function detach(w: Win, el: HTMLElement): void {
  const st = stage().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (w.dock && el.parentElement !== stage()) {
    stage().append(el);
    el.classList.add('is-floating');
  }
  el.classList.add('is-moved');
  Object.assign(el.style, {
    position: 'absolute',
    left: `${Math.round(r.left - st.left)}px`,
    top: `${Math.round(r.top - st.top)}px`,
    right: 'auto',
    bottom: 'auto',
    transform: 'none',
    margin: '0',
    width: `${Math.round(r.width)}px`,
    height: el.style.height || (w.id === 'panel' || w.id === 'dash' ? `${Math.round(r.height)}px` : ''),
  });
}

function persist(w: Win, el: HTMLElement): void {
  const s: Saved = { floating: el.classList.contains('is-floating') };
  if (el.classList.contains('is-moved')) {
    s.x = parseFloat(el.style.left) || 0;
    s.y = parseFloat(el.style.top) || 0;
  }
  if (el.style.width) s.w = parseFloat(el.style.width);
  if (el.style.height) s.h = parseFloat(el.style.height);
  save(w.id, s);
}

function front(el: HTMLElement): void {
  document.querySelectorAll('[data-front]').forEach((n) => n !== el && n.removeAttribute('data-front'));
  el.setAttribute('data-front', '');
}

function restore(w: Win, el: HTMLElement): void {
  for (const p of ['position', 'left', 'top', 'right', 'bottom', 'transform', 'margin', 'width', 'height']) el.style.removeProperty(p);
  el.classList.remove('is-moved', 'is-floating', 'grip-hot');
  if (w.dock) {
    const col = w.dock.column();
    // put the card back in its original order within the column
    const after = w.dock.order.slice(w.dock.order.indexOf(w.id) + 1).map((id) => document.getElementById(id)).find((n) => n?.parentElement === col);
    col.insertBefore(el, after ?? null);
  }
}

export function resetLayout(): void {
  for (const w of wins) {
    storage.set(key(w.id), 'null');
    const el = w.el();
    if (el) restore(w, el);
  }
  announce(t('win.reset.done'));
  window.dispatchEvent(new Event('resize'));
}

/** Apply the saved position/size (desktop). Called at start, after re-renders, and when leaving phone layout. */
export function applyWindow(id: string): void {
  if (mq.matches) return;
  const w = wins.find((x) => x.id === id);
  const el = w?.el();
  if (!w || !el) return;
  el.classList.add('win');
  const s = load(id);
  if (!s) return;
  if (s.x !== undefined && s.y !== undefined) {
    detach(w, el);
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
  }
  if (s.w) el.style.width = `${s.w}px`;
  if (s.h) el.style.height = `${s.h}px`;
  if (el.classList.contains('is-moved')) clamp(el);
}

function winOf(target: EventTarget | null): { w: Win; el: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  for (const w of wins) {
    const el = w.el();
    if (el && el.contains(target)) return { w, el };
  }
  return null;
}

function inGrip(el: HTMLElement, e: PointerEvent | MouseEvent): boolean {
  const r = el.getBoundingClientRect();
  return e.clientY - r.top >= 0 && e.clientY - r.top < GRIP && e.clientX > r.left && e.clientX < r.right - 4;
}

function inResizer(el: HTMLElement, e: PointerEvent): boolean {
  const r = el.getBoundingClientRect();
  return r.right - e.clientX < 18 && r.bottom - e.clientY < 18;
}

export function initWindows(): void {
  wins.push(
    { id: 'titlecard', el: () => document.getElementById('titlecard'), dock: { column: () => $('#leftcol'), order: ['titlecard', 'layers-card', 'legend-card'] } },
    { id: 'layers-card', el: () => document.getElementById('layers-card'), dock: { column: () => $('#leftcol'), order: ['titlecard', 'layers-card', 'legend-card'] } },
    { id: 'legend-card', el: () => document.getElementById('legend-card'), dock: { column: () => $('#leftcol'), order: ['titlecard', 'layers-card', 'legend-card'] } },
    { id: 'panel', el: () => document.getElementById('panel') },
    { id: 'dash', el: () => document.getElementById('dash') },
    { id: 'tracker', el: () => document.querySelector<HTMLElement>('.tracker') },
    { id: 'story', el: () => document.querySelector<HTMLElement>('#story-layer .story-card') },
  );
  for (const w of wins) applyWindow(w.id);

  // A press in the top strip becomes a drag once the pointer moves more than 5 px, even over header buttons
  // (tabs, dashboard controls), so every panel can be grabbed. A plain click still works as a click.
  let pending: { w: Win; el: HTMLElement; x: number; y: number; id: number } | null = null;
  let drag: { w: Win; el: HTMLElement; dx: number; dy: number; id: number } | null = null;
  let resizing: { w: Win; el: HTMLElement } | null = null;
  const NO_DRAG = 'input, select, textarea, .maplibregl-canvas';

  document.addEventListener('pointerdown', (e) => {
    if (mq.matches || e.button !== 0) return;
    const hit = winOf(e.target);
    if (!hit) return;
    const { w, el } = hit;
    if (w.id === 'dash' && document.documentElement.dataset.dash === 'max') return;
    front(el);
    if (inResizer(el, e)) {
      if (w.dock && !el.classList.contains('is-floating')) return; // docked cards: vertical resize only
      // Anchor at the top-left first, so the corner follows the cursor (panels docked to the right edge would grow leftwards).
      if (!el.classList.contains('is-moved')) detach(w, el);
      resizing = { w, el };
      return;
    }
    if (!inGrip(el, e) || (e.target as Element).closest(NO_DRAG)) return;
    pending = { w, el, x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  const swallowClick = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  document.addEventListener('pointermove', (e) => {
    if (pending && e.pointerId === pending.id && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 5) {
      const { w, el } = pending;
      pending = null;
      if (!el.classList.contains('is-moved')) detach(w, el);
      const r = el.getBoundingClientRect();
      drag = { w, el, dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      el.classList.add('is-dragging');
      document.addEventListener('click', swallowClick, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallowClick, { capture: true }), 400);
    }
    if (drag && e.pointerId === drag.id) {
      e.preventDefault();
      const st = stage().getBoundingClientRect();
      drag.el.style.left = `${Math.round(e.clientX - st.left - drag.dx)}px`;
      drag.el.style.top = `${Math.round(e.clientY - st.top - drag.dy)}px`;
      clamp(drag.el);
      return;
    }
    if (mq.matches) return;
    // highlight the grip strip under the cursor
    const hit = winOf(e.target);
    document.querySelectorAll('.grip-hot').forEach((n) => n !== hit?.el && n.classList.remove('grip-hot'));
    if (hit && !(e.target as Element).closest(NO_DRAG) && inGrip(hit.el, e) && !(hit.w.id === 'dash' && document.documentElement.dataset.dash === 'max')) hit.el.classList.add('grip-hot');
    else hit?.el.classList.remove('grip-hot');
  });

  const end = (e: PointerEvent) => {
    pending = null;
    if (drag && e.pointerId === drag.id) {
      drag.el.classList.remove('is-dragging');
      persist(drag.w, drag.el);
      drag = null;
      window.dispatchEvent(new Event('resize'));
    }
    if (resizing) {
      persist(resizing.w, resizing.el);
      resizing = null;
    }
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  document.addEventListener('dblclick', (e) => {
    if (mq.matches) return;
    const hit = winOf(e.target);
    if (!hit || !inGrip(hit.el, e) || (e.target as Element).closest(INTERACTIVE)) return;
    storage.set(key(hit.w.id), 'null');
    restore(hit.w, hit.el);
    window.dispatchEvent(new Event('resize'));
  });

  // Keyboard: Alt+arrows move the focused panel, Alt+Shift+arrows resize it.
  document.addEventListener('keydown', (e) => {
    if (mq.matches || !e.altKey || !e.key.startsWith('Arrow')) return;
    const hit = winOf(document.activeElement);
    if (!hit) return;
    const { w, el } = hit;
    if (w.id === 'dash' && document.documentElement.dataset.dash === 'max') return;
    e.preventDefault();
    const step = 16;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!el.classList.contains('is-moved')) detach(w, el);
    if (e.shiftKey) {
      const r = el.getBoundingClientRect();
      el.style.width = `${Math.max(220, Math.round(r.width + dx))}px`;
      el.style.height = `${Math.max(120, Math.round(r.height + dy))}px`;
    } else {
      el.style.left = `${(parseFloat(el.style.left) || 0) + dx}px`;
      el.style.top = `${(parseFloat(el.style.top) || 0) + dy}px`;
      clamp(el);
    }
    persist(w, el);
  });

  // Keep panels inside the map when the window shrinks; phone layout drops all custom positions.
  window.addEventListener('resize', () => {
    if (mq.matches) return;
    for (const w of wins) {
      const el = w.el();
      if (el?.classList.contains('is-moved')) clamp(el);
    }
  });
  mq.addEventListener('change', () => {
    for (const w of wins) {
      const el = w.el();
      if (!el) continue;
      if (mq.matches) {
        // Phone layout: undo the custom placement (floating cards go back into the hidden column) but keep the
        // saved positions, so they come back on desktop.
        restore(w, el);
        el.classList.remove('win');
      } else {
        window.setTimeout(() => applyWindow(w.id), 0);
      }
    }
  });
}

/** For camera framing: has the user moved this panel away from its docked place? */
export function isMoved(id: string): boolean {
  return !!document.getElementById(id)?.classList.contains('is-moved');
}
