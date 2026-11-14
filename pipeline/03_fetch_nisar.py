"""03 · Stream the Kedah window of each NISAR GCOV pass and put it on the 30 m Kedah grid (plan 04 §4.3, §4.5 step 2).

Reads only HHHH, HVHV and mask of frequency A for the study box (tens of MB of a ~5 GB file), then averages
linear power onto the 30 m UTM grid (averaging in linear power beats speckle; never average dB).
Output: data/work/kedah_<date_utc>_<stack>.tif with bands HH, HV (linear gamma0, NaN = no data).
Usage: python pipeline/03_fetch_nisar.py
"""
import json
import time

import h5py
import numpy as np
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from common import MANIFEST, WORK, area, grid, log, save_tif, session
from h5range import HTTPRangeFile

MARGIN = 2000  # metres around the box, so the warp has full pixels at the edges


def window(url: str, sess, bbox):
    f = HTTPRangeFile(url, sess)
    h = h5py.File(f, "r")
    g = h["/science/LSAR/GCOV/grids/frequencyA"]
    epsg = int(g["projection"][()])
    x = g["xCoordinates"][:]
    y = g["yCoordinates"][:]
    dx, dy = float(x[1] - x[0]), float(y[1] - y[0])
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    w, s, e, n = bbox
    xs, ys = zip(*(tr.transform(a, b) for a in (w, e) for b in (s, n)))
    c0 = max(0, int(np.searchsorted(x, min(xs) - MARGIN)))
    c1 = min(len(x), int(np.searchsorted(x, max(xs) + MARGIN)))
    r0 = max(0, int(np.searchsorted(-y, -(max(ys) + MARGIN))))
    r1 = min(len(y), int(np.searchsorted(-y, -(min(ys) - MARGIN))))
    # Fetch the byte ranges of every chunk inside the window in parallel first; the reads below then hit the cache.
    ranges = []
    for name in ("HHHH", "HVHV", "mask"):
        ds = g[name]
        ch = ds.chunks or ds.shape
        for i in range(ds.id.get_num_chunks()):
            info = ds.id.get_chunk_info(i)
            cr, cc = info.chunk_offset
            if cr + ch[0] > r0 and cr < r1 and cc + ch[1] > c0 and cc < c1 and info.byte_offset is not None:
                ranges.append((info.byte_offset, info.size))
    f.prefetch(ranges)
    hh = g["HHHH"][r0:r1, c0:c1].astype("float32")
    hv = g["HVHV"][r0:r1, c0:c1].astype("float32")
    mask = g["mask"][r0:r1, c0:c1]
    transform = from_origin(x[c0] - dx / 2, y[r0] - dy / 2, dx, -dy)
    log(f"  EPSG:{epsg} {r1 - r0}x{c1 - c0} px at {dx:.0f} m; streamed {f.bytes_fetched / 1e6:.0f} MB in {f.requests} requests")
    return hh, hv, mask, transform, epsg


def to_grid(a: np.ndarray, src_transform, src_epsg: int) -> np.ndarray:
    crs, transform, width, height = grid("kedah")
    out = np.full((height, width), np.nan, dtype="float32")
    reproject(a, out, src_transform=src_transform, src_crs=f"EPSG:{src_epsg}", src_nodata=np.nan,
              dst_transform=transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)
    return out


if __name__ == "__main__":
    m = json.loads((MANIFEST / "kedah.json").read_text(encoding="utf-8"))
    bbox = area("kedah")["bbox"]
    sess = session()
    for p in m["passes"]:
        if not p["nisar"]:
            continue
        out = WORK / f"kedah_{p['date_utc']}_{p['track']}.tif"
        if out.exists():
            log(f"skip {out.name}")
            continue
        t = time.time()
        log(f"{p['date_utc']} {p['track']} ({p['nisar']['collection']})")
        hh, hv, mask, tr, epsg = window(p["nisar"]["h5"], sess, bbox)
        bad = ~np.isfinite(hh) | (hh <= 0) | (mask == 255)
        hh[bad] = np.nan
        hv[bad | ~np.isfinite(hv) | (hv <= 0)] = np.nan
        hh_g, hv_g = to_grid(hh, tr, epsg), to_grid(hv, tr, epsg)
        valid = np.isfinite(hh_g).mean() * 100
        save_tif(out, {"HH": hh_g, "HV": hv_g}, "kedah", nodata=np.nan,
                 tags={"granule": p["nisar"]["id"], "collection": p["nisar"]["collection"], "units": "linear gamma0"})
        db = 10 * np.log10(hh_g[np.isfinite(hh_g)])
        log(f"  valid {valid:.1f}%  HH dB p5/p50/p95 {np.percentile(db, [5, 50, 95]).round(1)}  {time.time() - t:.0f}s -> {out.name}")
