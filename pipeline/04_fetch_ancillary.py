"""04 · Context layers on each processing grid (plan 04 §3.4), read as windows over HTTPS, no login.

- JRC Global Surface Water occurrence 1984–2021 (% of months with water), 30 m, nearest.
- ESA WorldCover 2021 v200 land cover, 10 m → 30 m by mode.
- DOSM district raster (codes from public/data/districts.geojson), for district hectares.
Output: data/work/<area>_ancillary.tif with bands jrc, worldcover, district.
Usage: python pipeline/04_fetch_ancillary.py
"""
import json
import math

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import Resampling, reproject, transform_geom
from rasterio.windows import from_bounds

from common import WEB, WORK, area, grid, log, save_tif

JRC = "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_{lon}E_{lat}Nv1_4_2021.tif"
WC = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{lat:02d}E{lon:03d}_Map.tif"
PAD = 0.05  # degrees around the box


def jrc_tiles(bbox):
    w, s, e, n = bbox
    for lon in range(int(math.floor(w / 10) * 10), int(e) + 1, 10):
        for lat in range(int(math.ceil(s / 10) * 10), int(math.ceil(n / 10) * 10) + 1, 10):
            yield JRC.format(lon=lon, lat=lat)  # JRC tiles are named by their north-west corner


def wc_tiles(bbox):
    w, s, e, n = bbox
    for lon in range(int(math.floor(w / 3) * 3), int(e) + 1, 3):
        for lat in range(int(math.floor(s / 3) * 3), int(n) + 1, 3):
            yield WC.format(lon=lon, lat=lat)  # WorldCover tiles are named by their south-west corner


def warp_from(urls, area_id: str, resampling, nodata: int) -> np.ndarray:
    crs, transform, width, height = grid(area_id)
    w, s, e, n = area(area_id)["bbox"]
    out = np.full((height, width), nodata, dtype="uint8")
    for url in urls:
        try:
            src = rasterio.open(url)
        except rasterio.errors.RasterioIOError:
            continue
        with src:
            b = src.bounds
            if b.right <= w - PAD or b.left >= e + PAD or b.top <= s - PAD or b.bottom >= n + PAD:
                continue
            win = from_bounds(max(w - PAD, b.left), max(s - PAD, b.bottom), min(e + PAD, b.right), min(n + PAD, b.top), src.transform)
            win = win.round_offsets().round_lengths()
            data = src.read(1, window=win)
            part = np.full_like(out, nodata)
            reproject(data, part, src_transform=src.window_transform(win), src_crs=src.crs, src_nodata=None,
                      dst_transform=transform, dst_crs=crs, dst_nodata=nodata, resampling=resampling)
            fill = part != nodata
            out[fill] = part[fill]
            log(f"  {url.rsplit('/', 1)[1]}: window {data.shape}")
    return out


def districts(area_id: str) -> tuple[np.ndarray, dict[int, dict]]:
    crs, transform, width, height = grid(area_id)
    gj = json.loads((WEB / "districts.geojson").read_text(encoding="utf-8"))
    states = set(area(area_id).get("states", []))
    shapes, lookup = [], {}
    for i, f in enumerate([f for f in gj["features"] if f["properties"].get("state") in states], start=1):
        shapes.append((transform_geom("EPSG:4326", crs, f["geometry"]), i))
        lookup[i] = {"code": f["properties"]["code"], "district": f["properties"]["district"], "state": f["properties"]["state"]}
    ras = rasterize(shapes, out_shape=(height, width), transform=transform, fill=0, dtype="uint8")
    return ras, lookup


if __name__ == "__main__":
    for area_id in ("kelantan", "kedah"):
        log(area_id)
        bbox = area(area_id)["bbox"]
        jrc = warp_from(jrc_tiles(bbox), area_id, Resampling.nearest, 255)
        wc = warp_from(wc_tiles(bbox), area_id, Resampling.mode, 0)
        dist, lookup = districts(area_id)
        save_tif(WORK / f"{area_id}_ancillary.tif", {"jrc": jrc, "worldcover": wc, "district": dist}, area_id,
                 tags={"districts": json.dumps(lookup)})
        log(f"  JRC valid {np.mean(jrc != 255) * 100:.0f}%, permanent (>=80%) {np.mean((jrc >= 80) & (jrc <= 100)) * 100:.1f}%; "
            f"cropland {np.mean(wc == 40) * 100:.1f}%, built-up {np.mean(wc == 50) * 100:.1f}%; {len(lookup)} districts")
