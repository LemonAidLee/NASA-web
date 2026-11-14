// How much of each DOSM district falls inside each study-area box (layers.json bbox).
import fs from 'node:fs';
import * as turf from '@turf/turf';
const fc = JSON.parse(fs.readFileSync('public/data/districts.geojson', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('public/data/layers.json', 'utf8'));
for (const a of cfg.areas.filter((x) => x.kind !== 'explore')) {
  const box = turf.bboxPolygon(a.bbox);
  console.log(`\n${a.id} box ${a.bbox.join(',')}  (box area ${(turf.area(box) / 1e6).toFixed(0)} km2)`);
  const rows = [];
  for (const f of fc.features) {
    const inter = turf.intersect(turf.featureCollection([f, box]));
    if (!inter) continue;
    const a1 = turf.area(f), ai = turf.area(inter);
    rows.push([f.properties.state, f.properties.district, ai / a1, ai / turf.area(box), a1 / 1e6]);
  }
  rows.sort((x, y) => y[2] - x[2]);
  for (const r of rows) console.log(`  ${r[0].padEnd(9)} ${r[1].padEnd(14)} ${(r[2] * 100).toFixed(0).padStart(3)}% of district inside | ${(r[3] * 100).toFixed(0).padStart(3)}% of box | district ${r[4].toFixed(0)} km2`);
}
