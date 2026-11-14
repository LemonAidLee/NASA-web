// Radar water map: NASA Space Apps 2026, "Dancing with the SARs". Boot, styles and map protocols.
import './styles/tokens.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/geist';
import '@fontsource-variable/saira/wdth.css'; // display face for the Deep Space theme (OFL-1.1, self-hosted)
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/app.css';
import './styles/focus.css';
import './styles/panels.css';
import './styles/deep-space.css';
import './styles/charts.css';
import './styles/rails.css';

import { addProtocol, setWorkerUrl } from 'maplibre-gl';
// MapLibre v6 under Vite: worker via ?worker&url, set once before the first map (plan 06 §1.3 item 1).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { Protocol } from 'pmtiles';

import { area, fmtDate, loadConfig, studyBbox } from './config';
import { t } from './i18n';
import { $, announce, h } from './lib/dom';
import * as S from './state';
import { createMap, fitArea } from './map/mainMap';
import { initCompare } from './map/compare';
import { loadDistricts } from './map/districts';
import { loadStats } from './lib/stats';
import { initTopBar } from './ui/topBar';
import { initLeftCol } from './ui/leftCol';
import { initTimeControl } from './ui/timeControl';
import { initPanel } from './ui/panel';
import { initMapInteract } from './ui/mapInteract';
import { initStory } from './ui/story';
import { initShortcuts } from './ui/shortcuts';
import { initLayout } from './ui/layout';
import { initFocus } from './ui/focus';
import { initTracker } from './ui/tracker';
import { initWindows } from './ui/windows';
import { initRails } from './ui/rails';

setWorkerUrl(workerUrl);
// Registered once at startup (plan 06 §6.3 rule 6). No COG layers exist yet: our baked COGs arrive at the event.
addProtocol('cog', cogProtocol);
addProtocol('pmtiles', new Protocol().tile);

function applyRoot(s: S.State): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.mode = s.mode;
  root.dataset.area = s.area;
  root.dataset.compare = s.compare;
}

function mapLabel(s: S.State): void {
  const a = area(s.area);
  const key = a.kind === 'explore' ? 'a11y.sentence.exp' : s.area === 'kelantan' ? 'a11y.sentence.kel' : 'a11y.sentence.ked';
  $('#map').setAttribute('aria-label', t('a11y.map', { area: t(a.name), date: fmtDate(s.date), sentence: t(key, { date: fmtDate(s.date) }) }));
}

function toast(msg: string): void {
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  $('#overlay-root').append(el);
  window.setTimeout(() => el.remove(), 2200);
}

async function boot(): Promise<void> {
  try {
    await Promise.all([loadConfig(), loadDistricts(), loadStats()]);
  } catch (e) {
    $('#map').append(h('p', { class: 'map-error' }, t('err.data', { file: String((e as Error).message) })));
    return;
  }
  const s = S.initState(); // may put the saved camera into the address
  const hadCamera = location.hash.includes('map='); // a shared link or saved view with a camera keeps it
  applyRoot(s);
  mapLabel(s);
  S.subscribe((st, ch) => {
    if (['theme', 'mode', 'area', 'compare'].some((k) => ch.has(k as keyof S.State))) applyRoot(st);
    if (ch.has('area') || ch.has('date')) mapLabel(st);
  });
  document.addEventListener('toast', (e) => toast(String((e as CustomEvent).detail)));

  const map = createMap($('#map'));
  if (!map) return;
  initTopBar();
  initLeftCol();
  initTimeControl();
  initPanel();
  initLayout();
  // The map was sized before the HUD bars were filled in; once they exist the map is shorter, so fit the
  // study-area box again (clear of the side panels) so the whole dotted outline is in view.
  if (!hadCamera && area(s.area).kind !== 'explore') {
    requestAnimationFrame(() => {
      map.resize();
      fitArea(studyBbox(s.area), false);
    });
  }
  initMapInteract();
  initCompare();
  initFocus();
  initTracker();
  initWindows();
  initRails();
  initShortcuts();
  map.once('load', () => {
    announce(t('a11y.loaded', { date: fmtDate(S.get().date) }));
    initStory();
  });
}

void boot();
