// Adds the DOSM district code and a marker point inside each focus district to public/data/focus_areas.json.
// Run: node scripts/make-focus-areas.mjs
import fs from 'node:fs';
import * as turf from '@turf/turf';
const path = 'public/data/focus_areas.json';
const focus = JSON.parse(fs.readFileSync(path, 'utf8'));
const districts = JSON.parse(fs.readFileSync('public/data/districts.geojson', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('public/data/layers.json', 'utf8'));
for (const [areaId, list] of Object.entries(focus.areas)) {
  const area = cfg.areas.find((a) => a.id === areaId);
  const states = area.states;
  const box = turf.bboxPolygon(area.bbox);
  for (const f of list) {
    const d = districts.features.find((x) => x.properties.district === f.district && states.includes(x.properties.state));
    if (!d) throw new Error(`no district ${f.district}`);
    // Centre of mass if it falls inside the district, else a guaranteed interior point.
    let p = turf.centerOfMass(d);
    if (!turf.booleanPointInPolygon(p, d)) p = turf.pointOnFeature(d);
    f.code = d.properties.code;
    f.center = p.geometry.coordinates.map((v) => Math.round(v * 1e4) / 1e4);
    const inside = turf.intersect(turf.featureCollection([d, box]));
    f.area_km2 = Math.round(turf.area(d) / 1e6);
    f.inside_pct = inside ? Math.round((turf.area(inside) / turf.area(d)) * 100) : 0;
    console.log(`${areaId} ${f.district.padEnd(12)} code ${f.code} center ${f.center.join(',')} area ${f.area_km2} km2 inside ${f.inside_pct}%`);
  }
}
fs.writeFileSync(path, JSON.stringify(focus, null, 2) + '\n');
