// Run: node --experimental-strip-types --test tests/gibsWms.test.ts   (set OFFLINE=1 to skip the live part)
// Bug (12 Nov 2026): zooming showed a different picture at each zoom. GIBS's WMTS tile endpoint returns a different,
// often corrupted image for the same NISAR / DSWx-S1 tile URL. Its WMS endpoint renders the same area correctly and identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gibsTileTemplate } from '../src/lib/gibs.ts';

const R = 20037508.342789244;
const bbox = (x: number, y: number, z: number) => {
  const s = (2 * R) / 2 ** z;
  return [-R + x * s, R - (y + 1) * s, -R + (x + 1) * s, R - y * s].map((v) => v.toFixed(2)).join(',');
};

test('NISAR and DSWx-S1 use the WMS endpoint with a 3857 bbox template', () => {
  for (const layer of ['NISAR_L2_Geocoded_Polarimetric_Covariance', 'OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1']) {
    const { url, tileSize } = gibsTileTemplate({ wms_layer: layer }, '2026-10-05', 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best');
    assert.match(url, /\/wms\/epsg3857\/best\/wms\.cgi\?/);
    assert.match(url, /BBOX=\{bbox-epsg-3857\}/);
    assert.match(url, new RegExp(`LAYERS=${layer}&`));
    assert.match(url, /TIME=2026-10-05/);
    assert.match(url, new RegExp(`WIDTH=${tileSize}&HEIGHT=${tileSize}`));
  }
});

test('layers without a WMS name keep their WMTS tile URL', () => {
  const { url, tileSize } = gibsTileTemplate({ url: '{gibs}/VIIRS/default/{date}/L9/{z}/{y}/{x}.jpg' }, '2024-11-29', 'https://g/best');
  assert.equal(url, 'https://g/best/VIIRS/default/2024-11-29/L9/{z}/{y}/{x}.jpg');
  assert.equal(tileSize, 256);
});

// Tiles measured as corrupted / non-deterministic through WMTS on 12 Nov 2026.
const BAD = [
  ['NISAR_L2_Geocoded_Polarimetric_Covariance', '2026-10-05', 797, 494, 10],
  ['NISAR_L2_Geocoded_Polarimetric_Covariance', '2026-10-05', 1594, 989, 11],
  ['NISAR_L2_Geocoded_Polarimetric_Covariance', '2026-10-22', 3210, 1979, 12],
] as const;

test('live GIBS: the same area gives identical bytes on every load', { skip: process.env.OFFLINE === '1' }, async () => {
  for (const [layer, date, x, y, z] of BAD) {
    const { url, tileSize } = gibsTileTemplate({ wms_layer: layer }, date, 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best');
    // MapLibre asks 512 px tiles one zoom level lower; any bbox works for the determinism check.
    const u = url.replace('{bbox-epsg-3857}', bbox(x, y, z));
    const hashes: string[] = [];
    for (let k = 0; k < 3; k++) {
      const res = await fetch(u);
      assert.equal(res.status, 200, u);
      const b = new Uint8Array(await res.arrayBuffer());
      hashes.push(`${b.length}:${b.reduce((h, v) => (h * 31 + v) >>> 0, 7)}`);
    }
    assert.equal(new Set(hashes).size, 1, `${layer} ${date} z${z}: ${hashes.join(', ')}`);
    assert.ok(tileSize === 512);
  }
});
