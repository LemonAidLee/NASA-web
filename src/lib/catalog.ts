// NASA catalogue lookups straight from the browser, no login, no server.
// Checked 14 Nov 2026: CMR (cmr.earthdata.nasa.gov) and the ASF Search API (api.daac.asf.alaska.edu) both send
// Access-Control-Allow-Origin, and NISAR browse PNGs and their KML corner files are public behind a CORS-enabled redirect.

export type Bbox = [number, number, number, number]; // W, S, E, N

export type CollectionKey = 'nisar_gcov' | 'opera_rtc' | 'opera_dswx';

interface Collection {
  /** CMR concept IDs, newest product line first. */
  ids: string[];
  label: string;
  /** ASF Vertex search parameters; absent when ASF does not hold the product (DSWx-S1 lives at PO.DAAC). */
  vertex?: { dataset: string; productTypes: string };
}

/**
 * NISAR GCOV moved to a new collection on 21 Oct 2026: "NISAR Validated Geocoded Polarimetric Covariance Product"
 * (NISAR_L2_GCOV_V1, doi:10.5067/NIL2GCOV-V1). Passes before that date stay in the PROVISIONAL collection
 * (doi:10.5067/NIL2GCOV-P1). Asking only the old one froze "latest pass" at 19 Oct, so both are always asked.
 */
export const COLLECTIONS: Record<CollectionKey, Collection> = {
  nisar_gcov: { ids: ['C3622241360-ASF', 'C2854338529-ASF'], label: 'NISAR L2 GCOV', vertex: { dataset: 'NISAR', productTypes: 'GCOV' } },
  opera_rtc: { ids: ['C2777436413-ASF'], label: 'OPERA RTC-S1', vertex: { dataset: 'OPERA-S1', productTypes: 'RTC' } },
  opera_dswx: { ids: ['C2949811996-POCLOUD'], label: 'OPERA DSWx-S1' },
};

const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const ASF = 'https://api.daac.asf.alaska.edu/services/search/param';
const TIMEOUT = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

interface CmrFeed {
  feed: { entry: { time_start: string; title: string }[] };
}

/** Panels redraw often; one answer per product and box is kept for five minutes. */
const latestCache = new Map<string, { at: number; p: Promise<string | null> }>();

/** Newest acquisition time (ISO, UTC) of a product over a box, across all of its collections; null if none. */
export function latestTime(key: CollectionKey, bbox: Bbox): Promise<string | null> {
  const k = `${key}|${bbox.join(',')}`;
  const hit = latestCache.get(k);
  if (hit && Date.now() - hit.at < 300_000) return hit.p;
  const p = latestTimeUncached(key, bbox);
  p.catch(() => latestCache.delete(k));
  latestCache.set(k, { at: Date.now(), p });
  return p;
}

async function latestTimeUncached(key: CollectionKey, bbox: Bbox): Promise<string | null> {
  const results = await Promise.allSettled(
    COLLECTIONS[key].ids.map((id) =>
      getJson<CmrFeed>(`${CMR}?collection_concept_id=${id}&bounding_box=${bbox.join(',')}&sort_key=-start_date&page_size=1`),
    ),
  );
  const times = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.feed.entry.map((e) => e.time_start) : []));
  if (!times.length && results.every((r) => r.status === 'rejected')) throw new Error('catalogue unreachable');
  return times.sort().at(-1) ?? null;
}

/** UTC calendar days with at least one granule of a product over a box, between two dates (inclusive), ascending. */
export async function acquisitionDays(key: CollectionKey, bbox: Bbox, start: string, end: string): Promise<string[]> {
  const temporal = `${start}T00:00:00Z,${end}T23:59:59Z`;
  const results = await Promise.allSettled(
    COLLECTIONS[key].ids.map((id) =>
      getJson<CmrFeed>(`${CMR}?collection_concept_id=${id}&bounding_box=${bbox.join(',')}&temporal=${temporal}&sort_key=start_date&page_size=500`),
    ),
  );
  const days = new Set<string>();
  for (const r of results) if (r.status === 'fulfilled') for (const e of r.value.feed.entry) days.add(e.time_start.slice(0, 10));
  return [...days].sort();
}

// ---------- ASF: newest NISAR pass with its public browse picture ----------

export interface BrowseFrame {
  granule: string;
  /** ISO start time, UTC. */
  time: string;
  path: number;
  frame: number;
  direction: string;
  /** Lat/lon-gridded browse PNG (public, CORS). */
  png: string;
  /** KML with the PNG's corner coordinates. */
  kml: string;
}

interface AsfFeature {
  properties: {
    sceneName: string;
    startTime: string;
    pathNumber: number;
    frameNumber: number;
    flightDirection: string;
    orbit: number;
    browse: string[] | null;
    additionalUrls: string[] | null;
  };
}

/**
 * All frames of the newest NISAR GCOV pass that touches the box. One pass is usually two or three frames along the
 * same orbit; they are returned together so the picture has no seams.
 */
export async function latestNisarPass(bbox: Bbox): Promise<BrowseFrame[]> {
  const [w, s, e, n] = bbox;
  const wkt = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const url = `${ASF}?dataset=NISAR&processingLevel=GCOV&intersectsWith=${encodeURIComponent(wkt)}&maxResults=12&output=geojson`;
  const fc = await getJson<{ features: AsfFeature[] }>(url);
  const feats = fc.features
    .map((f) => f.properties)
    .filter((p) => p.browse?.some((b) => b.endsWith('_LATLON.png')) && p.additionalUrls?.some((u) => u.endsWith('_LATLON.kml')))
    .sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
  if (!feats.length) return [];
  const orbit = feats[0].orbit;
  return feats
    .filter((p) => p.orbit === orbit)
    .map((p) => ({
      granule: p.sceneName,
      time: p.startTime.endsWith('Z') ? p.startTime : `${p.startTime}Z`,
      path: p.pathNumber,
      frame: p.frameNumber,
      direction: p.flightDirection,
      png: (p.browse as string[]).find((b) => b.endsWith('_LATLON.png')) as string,
      kml: (p.additionalUrls as string[]).find((u) => u.endsWith('_LATLON.kml')) as string,
    }));
}

/** Reads the four lon/lat corners out of a NISAR browse KML (gx:LatLonQuad: SW, SE, NE, NW). */
export async function kmlCorners(url: string): Promise<[number, number][]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  const m = /<coordinates>([^<]+)<\/coordinates>/.exec(text);
  if (!m) throw new Error('no corners in KML');
  const pts = m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);
  if (pts.length < 4 || pts.some((p) => p.some((v) => !Number.isFinite(v)))) throw new Error('bad corners in KML');
  return pts.slice(0, 4);
}

// ---------- "Get this data" links ----------

const iso = (d: string, end = false) => `${d}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;

/** Earthdata Search, opened on this product, this box and this date window. */
export function earthdataSearchUrl(key: CollectionKey, bbox: Bbox, start: string, end: string): string {
  const p = new URLSearchParams();
  // "A!B": A is opened, B is added to the project, so NISAR passes from both product lines stay one click away.
  p.set('p', COLLECTIONS[key].ids.join('!'));
  p.set('sb[0]', bbox.join(','));
  p.set('qt', `${iso(start)},${iso(end, true)}`);
  return `https://search.earthdata.nasa.gov/search/granules?${p.toString()}`;
}

/** ASF Vertex, opened on this product, this box and this date window (null when ASF does not hold it). */
export function vertexUrl(key: CollectionKey, bbox: Bbox, start: string, end: string): string | null {
  const v = COLLECTIONS[key].vertex;
  if (!v) return null;
  const [w, s, e, n] = bbox;
  const p = new URLSearchParams({
    dataset: v.dataset,
    productTypes: v.productTypes,
    polygon: `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`,
    start: `${start}T00:00:00Z`,
    end: `${end}T23:59:59Z`,
  });
  return `https://search.asf.alaska.edu/#/?${p.toString()}`;
}

/** NASA Worldview on the same layer and day (GIBS layer name). */
export function worldviewUrl(gibsLayer: string, bbox: Bbox, date: string): string {
  const [w, s, e, n] = bbox;
  return `https://worldview.earthdata.nasa.gov/?v=${w},${s},${e},${n}&l=${gibsLayer},Coastlines_15m,OSM_Land_Water_Map&t=${date}-T00:00:00Z`;
}
