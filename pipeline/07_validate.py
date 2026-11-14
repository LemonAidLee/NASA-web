"""07 · Agreement with NASA's OPERA DSWx-S1 water maps (plan 05 §2–§4).

Kelantan: our single-date water test (detector A) vs DSWx-S1 from the same Sentinel-1 pass: a consistency check,
because both come from the same radar. Kedah: NISAR field water vs DSWx-S1 from the nearest Sentinel-1D pass,
on cropland only: an independent comparison (different radar, a few days apart).
DSWx-S1 WTR codes (JPL spec Table 4-1): 0 not water · 1 open water · 3 inundated vegetation · 250 HAND-masked
· 251 layover/shadow · 255 fill. Water = 1 or 3; compared only where DSWx is 0, 1 or 3.
Outputs: data/work/validation.json, data/work/kedah_<date>_disagree.tif (1 NISAR only · 2 DSWx only).
Usage: python pipeline/07_validate.py
"""
import json
from datetime import date

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

from common import MANIFEST, RAW, WORK, grid, load_tif, log, save_tif


def dswx_mosaic(area_id: str, tiles: list[dict]) -> np.ndarray:
    crs, transform, width, height = grid(area_id)
    out = np.full((height, width), 255, "uint8")
    for t in tiles:
        path = RAW / "dswx" / t["wtr"].rsplit("/", 1)[1]
        if not path.exists():
            continue
        with rasterio.open(path) as src:
            part = np.full((height, width), 255, "uint8")
            reproject(rasterio.band(src, 1), part, src_nodata=255, dst_transform=transform, dst_crs=crs, dst_nodata=255,
                      resampling=Resampling.nearest)
        fill = (out == 255) & (part != 255)
        out[fill] = part[fill]
    return out


def scores(ours: np.ndarray, ref: np.ndarray, where: np.ndarray) -> dict:
    o, r = ours[where], ref[where]
    tp = int(np.sum(o & r)); fp = int(np.sum(o & ~r)); fn = int(np.sum(~o & r)); tn = int(np.sum(~o & ~r))
    n = tp + fp + fn + tn
    if n == 0:
        return {}
    oa = (tp + tn) / n
    pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n)
    return {
        "f1": round(2 * tp / max(2 * tp + fp + fn, 1), 3),
        "iou": round(tp / max(tp + fp + fn, 1), 3),
        "kappa": round((oa - pe) / (1 - pe), 3) if pe < 1 else None,
        "oa": round(oa, 3),
        "precision": round(tp / max(tp + fp, 1), 3),
        "recall": round(tp / max(tp + fn, 1), 3),
        "n_pixels": n, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def summary(rows: dict) -> dict:
    out = {}
    for k in ("f1", "iou", "kappa", "oa"):
        v = [r[k] for r in rows.values() if r.get(k) is not None]
        if v:
            out[k] = {"median": round(float(np.median(v)), 3), "min": round(min(v), 3), "max": round(max(v), 3)}
    gaps = [r["date_gap_days"] for r in rows.values() if "date_gap_days" in r]
    if gaps:
        out["date_gap_days"] = {"median": float(np.median(gaps)), "min": min(gaps), "max": max(gaps)}
    return out


if __name__ == "__main__":
    val = {}
    # ---- Kelantan: consistency check on the same pass ----
    kel = json.loads((MANIFEST / "kelantan.json").read_text(encoding="utf-8"))
    thr = json.loads((WORK / "kelantan_thresholds.json").read_text(encoding="utf-8"))
    rows = {}
    # Scored on land only: normal water (JRC ≥ 80% or WorldCover water, mostly sea) is left out. On 29 Nov 2024 the
    # storm-roughened sea was bright to the radar, and the sea's millions of pixels then swamped the land score.
    kanc = load_tif(WORK / "kelantan_ancillary.tif")
    land = ~(((kanc["jrc"] >= 80) & (kanc["jrc"] <= 100)) | (kanc["worldcover"] == 80))
    for p in kel["passes"]:
        d = p["date_utc"]
        vv = load_tif(WORK / f"kelantan_{d}_vv.tif")["VV_dB"]
        cls = load_tif(WORK / f"kelantan_{d}_class.tif")["class"]
        ours = np.isfinite(vv) & (vv < thr[d]["threshold_db"]) & (cls != 6)
        ref = dswx_mosaic("kelantan", p["dswx"])
        where = np.isin(ref, (0, 1, 3)) & np.isfinite(vv) & (cls != 6) & land
        s = scores(ours, np.isin(ref, (1, 3)), where)
        if s:
            rows[d] = {**s, "date_gap_days": 0}
            log(f"kelantan {d}: F1 {s['f1']} IoU {s['iou']} kappa {s['kappa']} ({s['n_pixels']:,} px)")
    val["kelantan"] = {"framing": "consistency (same radar), land only", "per_date": rows, "summary": summary(rows)}

    # ---- Kedah: independent comparison with the nearest Sentinel-1D pass ----
    ked = json.loads((MANIFEST / "kedah.json").read_text(encoding="utf-8"))
    checks = [c for c in ked["checks"] if c["dswx"]]
    rows = {}
    for p in ked["passes"]:
        d = p["date_utc"]
        f = WORK / f"kedah_{d}_water.tif"
        if not f.exists():
            continue
        w = load_tif(f)["water"]
        dd = date.fromisoformat(d)
        c = min(checks, key=lambda c: (abs((date.fromisoformat(c["date_utc"]) - dd).days), c["date_utc"]))
        gap = abs((date.fromisoformat(c["date_utc"]) - dd).days)
        ref = dswx_mosaic("kedah", c["dswx"])
        where = (w != 255) & np.isin(ref, (0, 1, 3))
        ours, theirs = w == 1, np.isin(ref, (1, 3))
        s = scores(ours, theirs, where)
        if s:
            rows[d] = {**s, "date_gap_days": gap, "dswx_date": c["date_utc"]}
            log(f"kedah {d} vs DSWx {c['date_utc']} ({gap} d): F1 {s['f1']} IoU {s['iou']} kappa {s['kappa']}")
        dis = np.zeros(w.shape, "uint8")
        dis[where & ours & ~theirs] = 1
        dis[where & ~ours & theirs] = 2
        save_tif(WORK / f"kedah_{d}_disagree.tif", {"disagree": dis}, "kedah", nodata=0, tags={"dswx_date": c["date_utc"]})
    val["kedah"] = {"framing": "independent (different radar, nearest pass)", "per_date": rows, "summary": summary(rows)}
    (WORK / "validation.json").write_text(json.dumps(val, indent=1), encoding="utf-8")
    log("wrote validation.json")
