// "Newest NISAR picture": the public browse PNG of the newest NISAR GCOV pass, found live through the ASF Search API.
// No login and no server: ASF search, the browse PNG and its KML corner file all allow cross-origin reads.
//
// The browse PNG is gridded in latitude/longitude, but MapLibre stretches an image source linearly in Web Mercator,
// which would shift the middle rows by up to ~300 m over a 3° frame. Each frame is redrawn row by row onto a canvas
// so its rows are evenly spaced in Mercator, and pure black (outside the radar strip) is made transparent.
import type { Map as MLMap } from 'maplibre-gl';
import { area, layer, type LayerDef } from '../config';
import { kmlCorners, latestNisarPass, type Bbox, type BrowseFrame } from '../lib/catalog';

export interface LatestInfo {
  state: 'idle' | 'loading' | 'ok' | 'none' | 'error';
  frames: BrowseFrame[];
  key: string;
}

export let latestInfo: LatestInfo = { state: 'idle', frames: [], key: '' };

interface Ready {
  frame: BrowseFrame;
  url: string; // blob URL of the reprojected picture
  coords: [[number, number], [number, number], [number, number], [number, number]];
}

const cache = new Map<string, Promise<Ready[]>>();
const PREFIX = 'nisar-latest-';
let shownKey = '';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latFromY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

async function prepare(frame: BrowseFrame): Promise<Ready> {
  const [corners, img] = await Promise.all([kmlCorners(frame.kml), loadImage(frame.png)]);
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const w = Math.min(...lons);
  const e = Math.max(...lons);
  const s = Math.min(...lats);
  const n = Math.max(...lats);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas');
  const yn = mercY(n);
  const ys = mercY(s);
  for (let j = 0; j < H; j++) {
    const lat = latFromY(yn + ((j + 0.5) / H) * (ys - yn));
    const src = Math.min(H - 1, Math.max(0, Math.floor(((n - lat) / (n - s)) * H)));
    g.drawImage(img, 0, src, W, 1, 0, j, W, 1);
  }
  const data = g.getImageData(0, 0, W, H);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
  g.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  return { frame, url: URL.createObjectURL(blob), coords: [[w, n], [e, n], [e, s], [w, s]] };
}

function fetchPass(bbox: Bbox, key: string): Promise<Ready[]> {
  let p = cache.get(key);
  if (!p) {
    p = latestNisarPass(bbox).then((frames) => Promise.all(frames.map(prepare)));
    p.catch(() => cache.delete(key)); // let a later attempt retry
    cache.set(key, p);
  }
  return p;
}

function announce(info: LatestInfo): void {
  latestInfo = info;
  document.dispatchEvent(new CustomEvent('nisar-latest', { detail: info }));
}

/** The box to search: the area's box, or the visible map (rounded, so small pans reuse the cache) in Explore. */
function searchBox(map: MLMap, areaId: string): { bbox: Bbox; key: string } {
  const a = area(areaId);
  if (a.kind !== 'explore') return { bbox: a.bbox, key: `area:${a.id}` };
  const b = map.getBounds();
  const r = (v: number) => Math.round(v * 2) / 2;
  const bbox: Bbox = [r(b.getWest()), r(b.getSouth()), r(b.getEast()), r(b.getNorth())];
  if (bbox[0] === bbox[2]) bbox[2] += 0.5;
  if (bbox[1] === bbox[3]) bbox[3] += 0.5;
  return { bbox, key: `view:${bbox.join(',')}` };
}

function hideAll(map: MLMap): void {
  for (const l of map.getStyle().layers) if (l.id.startsWith(PREFIX)) map.setLayoutProperty(l.id, 'visibility', 'none');
}

function show(map: MLMap, key: string, ready: Ready[], opacity: number): void {
  if (shownKey !== key || !map.getLayer(`${PREFIX}0`)) {
    for (const l of map.getStyle().layers.filter((x) => x.id.startsWith(PREFIX))) {
      map.removeLayer(l.id);
      if (map.getSource(l.id)) map.removeSource(l.id);
    }
    ready.forEach((r, i) => {
      const id = `${PREFIX}${i}`;
      map.addSource(id, { type: 'image', url: r.url, coordinates: r.coords });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } }, 'slot-context');
    });
    shownKey = key;
  }
  for (const l of map.getStyle().layers) {
    if (!l.id.startsWith(PREFIX)) continue;
    map.setLayoutProperty(l.id, 'visibility', 'visible');
    map.setPaintProperty(l.id, 'raster-opacity', opacity);
  }
}

/** Called from syncRasters (main map only). */
export function syncLatest(map: MLMap, areaId: string, on: boolean, opacity: number): void {
  if (!on) {
    hideAll(map);
    return;
  }
  const { bbox, key } = searchBox(map, areaId);
  if (key === shownKey && map.getLayer(`${PREFIX}0`)) {
    show(map, key, [], opacity);
    return;
  }
  hideAll(map);
  if (latestInfo.key !== key || latestInfo.state !== 'ok') announce({ state: 'loading', frames: [], key });
  fetchPass(bbox, key)
    .then((ready) => {
      if (searchBox(map, areaId).key !== key) return; // the view moved on while loading
      if (!ready.length) {
        announce({ state: 'none', frames: [], key });
        return;
      }
      if (!map.getLayer('slot-context')) return; // style still loading; style.load re-syncs
      show(map, key, ready, opacity);
      announce({ state: 'ok', frames: ready.map((r) => r.frame), key });
    })
    .catch(() => announce({ state: 'error', frames: [], key }));
}

export function latestLayer(): LayerDef | undefined {
  return layer('nisar_latest');
}
