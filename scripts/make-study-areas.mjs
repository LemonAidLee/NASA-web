// Builds public/data/study_areas.geojson: one merged outline per study area from the DOSM districts listed in
// layers.json (area.study_districts = districts with at least half their area inside the radar coverage box;
// see scripts/district-overlap.mjs). Run: node scripts/make-study-areas.mjs
import fs from 'node:fs';
import * as turf from '@turf/turf';

const districts = JSON.parse(fs.readFileSync('public/data/districts.geojson', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('public/data/layers.json', 'utf8'));
const out = [];
for (const a of cfg.areas) {
  if (!a.study_districts) continue;
  const parts = districts.features.filter((f) => a.study_districts.includes(f.properties.district) && a.states.includes(f.properties.state));
  if (parts.length !== a.study_districts.length) throw new Error(`${a.id}: found ${parts.length} of ${a.study_districts.length} districts`);
  // Shared borders in the simplified DOSM file do not line up exactly, so close tiny slivers with a 150 m buffer
  // before and after the union, then drop interior holes left by the gaps.
  const grown = parts.map((f) => turf.buffer(f, 0.15, { units: 'kilometers' }));
  let merged = turf.union(turf.featureCollection(grown));
  merged = turf.buffer(merged, -0.15, { units: 'kilometers' });
  const polys = merged.geometry.type === 'Polygon' ? [merged.geometry.coordinates] : merged.geometry.coordinates;
  const outer = polys.map((p) => [p[0]]).filter((p) => turf.area(turf.polygon(p)) > 1e6); // keep islands > 1 km2, no holes
  const geom = outer.length === 1 ? { type: 'Polygon', coordinates: outer[0] } : { type: 'MultiPolygon', coordinates: outer };
  const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : c.map(round));
  geom.coordinates = round(geom.coordinates);
  const bbox = turf.bbox({ type: 'Feature', geometry: geom, properties: {} }).map((v) => Math.round(v * 1e4) / 1e4);
  out.push({ type: 'Feature', properties: { id: a.id, districts: a.study_districts, bbox }, geometry: geom });
  console.log(`${a.id}: ${a.study_districts.length} districts -> ${geom.type}, ${outer.length} part(s), ${(turf.area(geom) / 1e6).toFixed(0)} km2, bbox ${bbox.join(',')}`);
}
fs.writeFileSync('public/data/study_areas.geojson', JSON.stringify({ type: 'FeatureCollection', features: out }));
