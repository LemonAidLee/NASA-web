// Read one pixel of a baked picture (pipeline/09_bake_web.py) at a map position, so the popup can say what our map
// holds there. The pictures are on a Web Mercator grid placed by their corners, so the lookup is linear in Mercator.
import type { LayerDef } from '../config';
import { dataUrl } from '../config';

const cache = new Map<string, Promise<{ w: number; h: number; data: Uint8ClampedArray }>>();

function load(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return reject(new Error('no canvas'));
        g.drawImage(img, 0, 0);
        resolve({ w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data });
      };
      img.onerror = () => reject(new Error(url));
      img.src = url;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const mercX = (lon: number) => lon;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** RGBA at a lon/lat, or null when outside the picture. */
export async function rgbaAt(l: LayerDef, key: string, lng: number, lat: number): Promise<[number, number, number, number] | null> {
  if (l.kind !== 'image' || !l.corners) return null;
  const [[w, n], , [e, s]] = l.corners;
  const fx = (mercX(lng) - mercX(w)) / (mercX(e) - mercX(w));
  const fy = (mercY(n) - mercY(lat)) / (mercY(n) - mercY(s));
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
  const img = await load(dataUrl(l.url.replace('{date}', key)));
  const x = Math.floor(fx * img.w);
  const y = Math.floor(fy * img.h);
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** Class code under a position (matching the picture's colour to the layer's class colours), or null. */
export async function classAt(l: LayerDef, key: string, lng: number, lat: number): Promise<number | null> {
  const px = await rgbaAt(l, key, lng, lat);
  if (!px || px[3] === 0) return null;
  let best: number | null = null;
  let bestD = Infinity;
  for (const c of l.classes ?? []) {
    if (!c.color) continue;
    const r = parseInt(c.color.slice(1, 3), 16);
    const g = parseInt(c.color.slice(3, 5), 16);
    const b = parseInt(c.color.slice(5, 7), 16);
    const d = Math.abs(r - px[0]) + Math.abs(g - px[1]) + Math.abs(b - px[2]);
    if (d < bestD) {
      bestD = d;
      best = c.code;
    }
  }
  return bestD < 30 ? best : null;
}

/** Radar brightness in dB under a position, from a grey picture (grey 1–255 spread over the layer's range). */
export async function dbAt(l: LayerDef & { encoding?: { range: [number, number] } }, key: string, lng: number, lat: number): Promise<number | null> {
  const px = await rgbaAt(l, key, lng, lat);
  const range = l.encoding?.range ?? l.range;
  if (!px || px[3] === 0 || px[0] === 0 || !range) return null;
  return range[0] + ((px[0] - 1) / 254) * (range[1] - range[0]);
}
