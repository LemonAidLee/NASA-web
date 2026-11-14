// District lookup for the cursor bar (F21), popup (F5) and district card (F14). DOSM boundaries.
import { dataUrl } from '../config';

type Ring = [number, number][];
interface District {
  state: string;
  district: string;
  code: string;
  polys: Ring[][];
  bbox: [number, number, number, number];
}

let districts: District[] = [];

export async function loadDistricts(): Promise<void> {
  const res = await fetch(dataUrl('data/districts.geojson'));
  if (!res.ok) return;
  const fc = (await res.json()) as {
    features: { properties: { state: string; district: string; code: string }; geometry: { type: string; coordinates: unknown } }[];
  };
  districts = fc.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polys)
      for (const [x, y] of poly[0]) {
        w = Math.min(w, x);
        s = Math.min(s, y);
        e = Math.max(e, x);
        n = Math.max(n, y);
      }
    return { ...f.properties, polys, bbox: [w, s, e, n] };
  });
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function districtAt(lng: number, lat: number): { state: string; district: string; code: string } | null {
  for (const d of districts) {
    const [w, s, e, n] = d.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    for (const poly of d.polys) {
      if (inRing(lng, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lng, lat, hole))) {
        return { state: d.state, district: d.district, code: d.code };
      }
    }
  }
  return null;
}

export function districtsOf(states: string[]): { state: string; district: string; code: string; bbox: [number, number, number, number] }[] {
  return districts
    .filter((d) => states.includes(d.state))
    .map(({ state, district, code, bbox }) => ({ state, district, code, bbox }))
    .sort((a, b) => a.district.localeCompare(b.district));
}

/** Every loaded district outline (Kedah, Perlis, Kelantan), for the destination picker's mini chart. */
export function allDistrictShapes(): { state: string; polys: Ring[][] }[] {
  return districts.map((d) => ({ state: d.state, polys: d.polys }));
}

export function districtByCode(code: string): District | undefined {
  return districts.find((d) => d.code === code);
}
