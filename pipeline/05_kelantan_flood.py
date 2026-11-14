"""05 · Kelantan flood classes from OPERA RTC-S1 VV (plan 04 §4.4).

Per pass: mosaic the bursts of one track onto the 30 m UTM 48N grid (average of linear power), 5×5 median on dB,
detector A = VV below a water threshold (Otsu, bimodality check, tile fallback, HydroSAR cap −15.5 dB),
detector B = drop of more than 3 dB from the first pass of the same track. Classes (uint8):
0 no data · 1 dry · 2 normal water (JRC ≥ 80% or WorldCover permanent water) · 3 new flood water (A and B) · 4 possible flood (A only)
· 5 town, radar unreliable (WorldCover built-up, non-flood pixels only) · 6 radar can't see here (layover/shadow).
Groups of 11 pixels or fewer (under 1 ha) are removed. HAND and slope masks are skipped (no HAND source pinned).
Output: data/work/kelantan_<date_utc>_vv.tif, kelantan_<date_utc>_class.tif, data/work/kelantan_thresholds.json.
Usage: python pipeline/05_kelantan_flood.py
"""
import json

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from common import CAP_VV, MANIFEST, RAW, WORK, grid, load_tif, log, save_tif, to_db, water_threshold

MMU = 11  # pixels: 1 ha at 30 m (plan 04 §4.4 step 8)
CHANGE_DB = -3.0


def mosaic(bursts: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Average linear VV over overlapping bursts; layover/shadow from the burst masks (1–3 = shadow/layover)."""
    crs, transform, width, height = grid("kelantan")
    total = np.zeros((height, width), "float64")
    count = np.zeros((height, width), "uint16")
    cantsee = np.zeros((height, width), bool)
    for b in bursts:
        with rasterio.open(RAW / "rtc" / b["vv"].rsplit("/", 1)[1]) as src:
            part = np.full((height, width), np.nan, "float32")
            reproject(rasterio.band(src, 1), part, src_nodata=src.nodata if src.nodata is not None else np.nan,
                      dst_transform=transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)
        ok = np.isfinite(part) & (part > 0)
        total[ok] += part[ok]
        count[ok] += 1
        with rasterio.open(RAW / "rtc" / b["mask"].rsplit("/", 1)[1]) as src:
            m = np.full((height, width), 255, "uint8")
            reproject(rasterio.band(src, 1), m, src_nodata=255, dst_transform=transform, dst_crs=crs, dst_nodata=255,
                      resampling=Resampling.nearest)
        cantsee |= (m >= 1) & (m <= 3)
    vv = np.where(count > 0, total / np.maximum(count, 1), np.nan).astype("float32")
    return vv, cantsee


def remove_small(mask: np.ndarray) -> np.ndarray:
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > MMU
    return keep[lab]


if __name__ == "__main__":
    m = json.loads((MANIFEST / "kelantan.json").read_text(encoding="utf-8"))
    anc = load_tif(WORK / "kelantan_ancillary.tif")
    jrc, wc = anc["jrc"], anc["worldcover"]
    # Normal water: JRC ≥ 80%, plus WorldCover permanent water (class 80), which also covers open sea beyond JRC's coast.
    permanent = ((jrc >= 80) & (jrc <= 100)) | (wc == 80)
    town = wc == 50
    refs: dict[str, np.ndarray] = {}
    out_thr = {}
    for p in m["passes"]:
        d, track = p["date_utc"], p["track"]
        vv_lin, cantsee = mosaic(p["rtc"])
        vv = ndimage.median_filter(np.nan_to_num(to_db(vv_lin), nan=-99), size=5).astype("float32")
        valid = np.isfinite(vv_lin) & (vv > -60)
        vv[~valid] = np.nan
        save_tif(WORK / f"kelantan_{d}_vv.tif", {"VV_dB": vv}, "kelantan", nodata=np.nan, tags={"track": track})
        thr = water_threshold(vv, valid & ~cantsee, CAP_VV)
        t = thr["threshold_db"]
        a = valid & ~cantsee & (vv < t)
        if track not in refs:
            refs[track] = vv
            b = np.zeros_like(a)
            ref_date = None
        else:
            b = valid & np.isfinite(refs[track]) & (vv - refs[track] < CHANGE_DB)
            ref_date = next(q["date_utc"] for q in m["passes"] if q["track"] == track)
        flood = remove_small(a & b & ~permanent)
        possible = remove_small(a & ~b & ~permanent) & ~flood
        cls = np.zeros(vv.shape, "uint8")
        cls[valid] = 1
        cls[valid & permanent] = 2
        cls[possible] = 4
        cls[flood] = 3
        cls[valid & town & ~flood] = 5
        cls[cantsee & ~flood] = 6
        save_tif(WORK / f"kelantan_{d}_class.tif", {"class": cls}, "kelantan", nodata=0, tags={"threshold_db": t, "reference": ref_date})
        # ±1 dB sensitivity of the flood area (plan 05: ranges, not single numbers).
        sens, masks = {}, {}
        for dt in (-1, 1):
            a2 = valid & ~cantsee & (vv < min(t + dt, CAP_VV))
            f2 = remove_small(a2 & b & ~permanent) if ref_date else np.zeros_like(a2)
            sens[str(dt)] = int(f2.sum())
            masks["flood_lo" if dt < 0 else "flood_hi"] = f2.astype("uint8")
        save_tif(WORK / f"kelantan_{d}_sens.tif", masks, "kelantan")
        out_thr[d] = {**thr, "track": track, "reference": ref_date, "flood_px": int(flood.sum()), "possible_px": int(possible.sum()),
                      "flood_px_minus1db": sens["-1"], "flood_px_plus1db": sens["1"], "valid_pct": round(float(valid.mean() * 100), 1),
                      "water_median_db": round(float(np.nanmedian(vv[a])), 2) if a.any() else None,
                      "land_median_db": round(float(np.nanmedian(vv[valid & ~a])), 2)}
        log(f"{d} {track}: T={t} dB ({thr['method']}, D={thr['ashman_d']}{', capped' if thr['capped'] else ''}); "
            f"flood {flood.sum() * 0.09:.0f} ha, possible {possible.sum() * 0.09:.0f} ha, valid {valid.mean() * 100:.0f}%")
    (WORK / "kelantan_thresholds.json").write_text(json.dumps(out_thr, indent=1), encoding="utf-8")
