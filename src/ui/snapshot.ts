// "Save a picture of this view": the map as a PNG with a caption band (place, date, the headline number, what the
// colours mean on screen, and the data credits), ready for a report, a slide or a message to a district office.
// Runs in the browser only; nothing is uploaded.
import { area, fmtDate, imageryOnly, layersFor } from '../config';
import { t } from '../i18n';
import { areaHeadline } from '../lib/stats';
import * as S from '../state';
import { map } from '../map/mainMap';

const SITE = 'project-sars-amoeba.vercel.app';

/** The WebGL canvas can only be read during the frame it was drawn (preserveDrawingBuffer is off), so grab it there. */
function grabMap(): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    map.once('render', () => {
      try {
        const src = map.getCanvas();
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d')?.drawImage(src, 0, 0);
        resolve(c);
      } catch (e) {
        reject(e);
      }
    });
    map.triggerRepaint();
  });
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export async function savePicture(): Promise<void> {
  const s = S.get();
  const a = area(s.area);
  const toast = (msg: string) => document.dispatchEvent(new CustomEvent('toast', { detail: msg }));
  let shot: HTMLCanvasElement;
  try {
    shot = await grabMap();
    shot.toDataURL(); // throws now if a picture from another site blocked reading (a "tainted" canvas)
  } catch {
    toast(t('snap.error'));
    return;
  }
  const k = shot.width / map.getCanvas().clientWidth; // device pixel ratio of the map canvas
  const pad = 20 * k;
  const W = shot.width;
  const g0 = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  const font = (px: number, weight = 400) => `${weight} ${px * k}px Geist, "Segoe UI", system-ui, sans-serif`;

  // Legend: the classes of the coloured layers on screen (at most six).
  const on = layersFor(s.area).filter((l) => s.layers[l.id]?.on && l.classes?.length);
  const keys = on.flatMap((l) => (l.classes ?? []).filter((c) => c.color && c.style !== 'none').map((c) => ({ color: c.color as string, name: t(c.name, { date: '' }) }))).slice(0, 6);

  const headline = imageryOnly(a) ? t('exp.badge') : areaHeadline(s.area, s.date, a.panel.headline, fmtDate, t);
  g0.font = font(14);
  const headLines = wrap(g0, headline, W - 2 * pad);
  const bandH = pad + 22 * k + headLines.length * 19 * k + (keys.length ? 26 * k : 0) + 34 * k + pad;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = shot.height + bandH;
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(shot, 0, 0);
  g.fillStyle = '#0f1222';
  g.fillRect(0, shot.height, W, bandH);
  g.fillStyle = '#e69f00';
  g.fillRect(0, shot.height, W, 3 * k);

  let y = shot.height + pad + 14 * k;
  g.fillStyle = '#ffffff';
  g.font = font(16, 600);
  g.fillText(`${t('app.title')} · ${t(a.short)} · ${fmtDate(s.date)}`, pad, y);
  y += 22 * k;
  g.font = font(14);
  g.fillStyle = '#d6d9ee';
  for (const line of headLines) {
    g.fillText(line, pad, y);
    y += 19 * k;
  }
  if (keys.length) {
    y += 6 * k;
    let x = pad;
    g.font = font(12);
    for (const key of keys) {
      g.fillStyle = key.color;
      g.fillRect(x, y - 10 * k, 12 * k, 12 * k);
      g.fillStyle = '#d6d9ee';
      g.fillText(key.name, x + 18 * k, y);
      x += 18 * k + g.measureText(key.name).width + 18 * k;
      if (x > W - 200 * k) break;
    }
    y += 20 * k;
  }
  g.font = font(11);
  g.fillStyle = '#9aa0c0';
  g.fillText(t('snap.credit'), pad, y + 8 * k);
  g.fillText(`${t('snap.notwarning')} · ${SITE}`, pad, y + 24 * k);

  const url = out.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = `radar-water-map_${s.area}_${s.date}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  toast(t('snap.done'));
}
