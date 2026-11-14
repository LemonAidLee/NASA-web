// NASA GIBS URL templates.
// Measured 12 Nov 2026: GIBS's WMTS tiles for NISAR GCOV and OPERA DSWx-S1 are non-deterministic for some tiles
// (the same URL returns a different image per request: correct, striped, black, empty, or pieces of another image),
// so the picture changed at every zoom step. GIBS's WMS endpoint renders the same layers correctly and identically,
// so layers with a `wms_layer` use WMS GetMap with MapLibre's {bbox-epsg-3857} template. VIIRS stays on WMTS (stable, cached).

export interface GibsLayerLike {
  url?: string;
  wms_layer?: string;
}

/** 512 px WMS images: a quarter of the requests of 256 px tiles; each costs about 0.5–1 s to render. */
export const WMS_TILE = 512;

export function gibsTileTemplate(l: GibsLayerLike, date: string, wmtsBase: string): { url: string; tileSize: number } {
  if (l.wms_layer) {
    const wmsBase = wmtsBase.replace('/wmts/', '/wms/');
    const q = [
      'SERVICE=WMS',
      'REQUEST=GetMap',
      'VERSION=1.3.0',
      `LAYERS=${l.wms_layer}`,
      'STYLES=',
      'CRS=EPSG:3857',
      'BBOX={bbox-epsg-3857}',
      `WIDTH=${WMS_TILE}`,
      `HEIGHT=${WMS_TILE}`,
      'FORMAT=image/png',
      'TRANSPARENT=TRUE',
      `TIME=${date}`,
    ].join('&');
    return { url: `${wmsBase}/wms.cgi?${q}`, tileSize: WMS_TILE };
  }
  return { url: (l.url ?? '').replace('{gibs}', wmtsBase).replace('{date}', date), tileSize: 256 };
}
