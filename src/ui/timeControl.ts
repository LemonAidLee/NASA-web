// F3 time control: pass-only stepping, play, date strip of real pass days, no-pass message, radar scene age.
import { addDays, area, imageryOnly, daysBetween, diffDays, fmtDate, fmtDay, layersFor, passesFor, primaryPasses, resolveDate, type Pass } from '../config';
import { t } from '../i18n';
import { announce, append, clear, h } from '../lib/dom';
import * as S from '../state';

export const timeControl = h('section', { class: 'time-control', 'aria-label': t('time.label') });
let playTimer = 0;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function step(dir: 1 | -1): void {
  const s = S.get();
  const a = area(s.area);
  if (imageryOnly(a)) {
    const [min, max] = a.date_range ?? [s.date, s.date];
    const d = addDays(s.date, dir);
    if (d >= min && d <= max) S.set({ date: d });
    return;
  }
  const list = primaryPasses(s.area);
  const next = dir === 1 ? list.find((p) => p.date_myt > s.date) : [...list].reverse().find((p) => p.date_myt < s.date);
  if (next) S.set({ date: next.date_myt });
}

export function togglePlay(force?: boolean): void {
  const playing = force ?? !S.get().playing;
  S.set({ playing });
}

function runPlay(playing: boolean): void {
  window.clearInterval(playTimer);
  if (!playing) return;
  if (reduced()) {
    step(1);
    S.set({ playing: false });
    return;
  }
  const s = S.get();
  const list = primaryPasses(s.area);
  if (list.length && s.date >= list[list.length - 1].date_myt) S.set({ date: list[0].date_myt });
  playTimer = window.setInterval(() => {
    if (document.hidden) return;
    const st = S.get();
    const l = primaryPasses(st.area);
    const next = l.find((p) => p.date_myt > st.date);
    if (next) S.set({ date: next.date_myt });
    else S.set({ playing: false });
  }, 1200);
}

function passWord(p: Pass): string {
  return t(Number(p.time_myt.slice(0, 2)) < 12 ? 'time.pass.am' : 'time.pass.pm');
}

function dateLine(s: S.State): string {
  const p = primaryPasses(s.area).find((x) => x.date_myt === s.date);
  if (!p) return fmtDate(s.date);
  return t('time.pass.line', { date: fmtDate(p.date_myt), time: p.time_myt, sensor: p.sensor, pass: passWord(p) });
}

/** "Radar picture from 29 Nov 2024 (this date)" or "Showing the nearest radar picture…" (plan 07 F3). */
function ageLine(s: S.State): HTMLElement | null {
  const main = layersFor(s.area).find((l) => l.dates === 'passes');
  if (!main) return null;
  const r = resolveDate(main, s.area, s.date);
  if (!r) return null;
  if (r.exact) return h('p', { class: 'age' }, t('time.age.this', { date: fmtDate(r.myt) }));
  const n = Math.abs(r.age);
  const old = n > 6;
  return h('p', { class: `age${old ? ' age-old' : ''}` },
    t(n === 1 ? 'time.age.near.1' : 'time.age.near', { date: fmtDay(r.myt), n, dir: t(r.age < 0 ? 'time.dir.before' : 'time.dir.after') }),
    old ? ` · ${t('time.age.older')}` : '');
}

function noPassBox(s: S.State): HTMLElement | null {
  const a = area(s.area);
  const list = primaryPasses(s.area);
  if (imageryOnly(a) || list.some((p) => p.date_myt === s.date)) return null;
  const before = [...list].reverse().find((p) => p.date_myt < s.date);
  const after = list.find((p) => p.date_myt > s.date);
  const desc = (p?: Pass) => {
    if (!p) return '—';
    const n = Math.abs(diffDays(p.date_myt, s.date));
    return t(`time.near.${p.date_myt < s.date ? 'before' : 'after'}${n === 1 ? '.1' : ''}`, { date: fmtDay(p.date_myt), n });
  };
  const box = h('div', { class: 'nopass', role: 'status' },
    h('p', {}, t('time.nopass', { date: fmtDay(s.date), area: t(a.short), n: a.revisit_days ?? 6, before: desc(before), after: desc(after) })),
    h('div', { class: 'nopass-actions' },
      before ? h('button', { class: 'pill pill-sm', onclick: () => S.set({ date: before.date_myt }) }, t('time.jump', { date: fmtDay(before.date_myt) })) : null,
      after ? h('button', { class: 'pill pill-sm', onclick: () => S.set({ date: after.date_myt }) }, t('time.jump', { date: fmtDay(after.date_myt) })) : null,
    ),
  );
  return box;
}

function strip(s: S.State): HTMLElement | null {
  const a = area(s.area);
  if (!a.strip) return null;
  const days = daysBetween(a.strip[0], a.strip[1]);
  const all = passesFor(s.area);
  const phaseStarts = new Map((a.phases ?? []).map((p) => [p.start, p.id]));
  const row = h('div', { class: 'strip', role: 'group', 'aria-label': t('time.strip'), style: `--days:${days.length}` });
  for (const d of days) {
    const here = all.filter((p) => p.date_myt === d);
    const prim = here.find((p) => p.primary);
    const check = here.find((p) => !p.primary && p.coverage_flag !== 'rough');
    const rough = here.find((p) => p.coverage_flag === 'rough');
    let label: string;
    let mark = '';
    const cls = ['cell'];
    if (prim) {
      label = t('time.cell.pass', { date: fmtDate(d), pass: passWord(prim), sensor: prim.sensor, track: prim.track, utc: `${prim.date_utc} ${prim.time_utc}` });
      mark = prim.direction === 'A' ? '▲' : '▼';
      cls.push('cell-pass');
    } else if (check) {
      label = t('time.cell.check', { date: fmtDate(d), track: check.track, utc: `${check.date_utc} ${check.time_utc}` });
      mark = '◇';
      cls.push('cell-check');
    } else if (rough) {
      label = t('time.cell.rough', { date: fmtDate(d), utc: `${rough.date_utc} ${rough.time_utc}` });
      cls.push('cell-none');
    } else {
      label = t('time.cell.none', { date: fmtDate(d) });
      cls.push('cell-none');
    }
    if (check?.coverage_flag === 'partial' || prim?.coverage_flag === 'partial') {
      cls.push('cell-partial');
      label += `, ${t('time.partial')}`;
    }
    if (rough) cls.push('cell-rough');
    const phase = phaseStarts.get(d);
    if (phase) label += `. ${t('time.cell.phase', { id: phase })}`;
    if (d === s.date) cls.push('is-current');
    row.append(
      h('button', { class: cls.join(' '), 'aria-label': label, title: label, 'aria-current': d === s.date ? 'date' : null, onclick: () => S.set({ date: d }) },
        h('span', { class: 'cell-mark', 'aria-hidden': 'true' }, mark),
        phase ? h('span', { class: 'cell-phase', 'aria-hidden': 'true' }, phase) : null,
      ),
    );
  }
  const first = days[0];
  const last = days[days.length - 1];
  return h('div', { class: 'strip-wrap' },
    row,
    h('div', { class: 'strip-ends', 'aria-hidden': 'true' }, h('span', {}, fmtDay(first)), h('span', {}, fmtDay(last))),
    h('p', { class: 'strip-key x-only', 'aria-hidden': 'true' },
      [t('time.legend.A'), t('time.legend.D'), s.area === 'kedah' ? t('time.legend.check') : null, s.area === 'kedah' ? t('time.legend.rough') : null, t('time.legend.none')]
        .filter(Boolean).join('   ')),
  );
}

function render(): void {
  const s = S.get();
  const a = area(s.area);
  clear(timeControl);
  const list = primaryPasses(s.area);
  const atStart = !imageryOnly(a) && !list.some((p) => p.date_myt < s.date);
  const atEnd = !imageryOnly(a) && !list.some((p) => p.date_myt > s.date);
  const controls = h('div', { class: 'time-buttons' },
    h('button', { class: 'pill pill-icon', 'aria-label': t('time.prev'), disabled: atStart, onclick: () => step(-1) }, '◀'),
    h('button', { class: 'pill pill-icon', 'aria-label': t('time.next'), disabled: atEnd, onclick: () => step(1) }, '▶'),
    !imageryOnly(a)
      ? h('button', { class: 'pill pill-icon', 'aria-label': s.playing ? t('time.pause') : t('time.play'), 'aria-pressed': String(s.playing), onclick: () => togglePlay() }, s.playing ? '❚❚' : '▷')
      : null,
  );
  append(timeControl, [
    h('div', { class: 'time-head' },
      controls,
      h('div', { class: 'time-text' },
        h('p', { class: 'date-big' }, dateLine(s)),
        ageLine(s),
      ),
    ),
    strip(s),
    noPassBox(s),
  ]);
}

export function initTimeControl(): void {
  render();
  S.subscribe((s, ch) => {
    if (['area', 'date', 'playing', 'mode'].some((k) => ch.has(k as keyof S.State))) render();
    if (ch.has('playing')) runPlay(s.playing);
    if (ch.has('area') && s.playing) S.set({ playing: false });
    if (ch.has('date')) {
      const box = timeControl.querySelector('.nopass p');
      announce(box ? (box.textContent ?? '') : dateLine(s));
    }
  });
}
