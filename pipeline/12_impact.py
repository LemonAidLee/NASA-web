"""12 · Kelantan impact: how long the water stayed, and how many people lived where it reached.

Run after 08_stats.py (it adds a "impact" block to public/data/stats.json and bakes one more picture).

1. How long the water stayed. For every 30 m pixel we count the radar passes on which our map shows new flood water
   (class 3). Passes come every 6 days (two Sentinel-1 tracks taking turns), so a pixel flooded on n passes in a row
   held water for at least (n − 1) × 6 days. Classes: 21 = seen on 1 pass, 22 = 2 passes, 23 = 3 or more.
   This is the "hydroperiod" idea from SAR flood and paddy studies, done with only the passes that exist.
2. People. WorldPop 2024 constrained population (100 m, people per cell, CC BY 4.0) is moved onto our 30 m grid with
   GDAL's "sum" resampling, so totals are kept. We count people living inside new flood water and within 250 m of it
   (homes usually sit on slightly higher ground next to flooded fields, and towns are greyed out by our map).
   These are exposure estimates, not counts of victims or evacuees.
3. Kedah per-pass verdicts for the spot history: one lossless picture whose red channel holds one bit per NISAR pass
   (water in the field on that pass, from the pipeline's own water masks) and green one bit per pass with data, so the
   popup's pass-by-pass chart agrees exactly with the maps.
Outputs: stats.json → kelantan.impact and kedah.wetbits; baked/kelantan_duration.webp and baked/kedah_wetbits.webp;
layers.json → kel_duration.
Usage: python pipeline/12_impact.py
"""
import importlib
import json

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from common import BAKED, LAYERS_JSON, RAW, WEB, WORK, area, download, grid, load_tif, log, passes

HA = 0.09
NEAR_M = 250
POP_URL = "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2024/MYS/v1/100m/constrained/mys_pop_2024_CN_100m_R2025A_v1.tif"
POP_TIF = RAW / "worldpop" / "mys_pop_2024_CN_100m_R2025A_v1.tif"


def population_on_grid() -> np.ndarray:
    if not POP_TIF.exists():
        import requests
        POP_TIF.parent.mkdir(parents=True, exist_ok=True)
        log("downloading WorldPop 2024 Malaysia (100 m, constrained)…")
        download(POP_URL, POP_TIF, requests.Session())
    crs, transform, w, h = grid("kelantan")
    out = np.zeros((h, w), np.float32)
    with rasterio.open(POP_TIF) as src:
        a = src.read(1).astype(np.float32)
        nd = src.nodata
        if nd is not None:
            a[a == nd] = 0
        a[~np.isfinite(a) | (a < 0)] = 0
        # "sum" spreads each 100 m cell over the 30 m pixels it covers, keeping the total.
        reproject(a, out, src_transform=src.transform, src_crs=src.crs, dst_transform=transform, dst_crs=crs,
                  src_nodata=0, dst_nodata=0, resampling=Resampling.sum)
    return out


def kedah_wetbits(bake) -> dict:
    dates = [p["date_utc"] for p in passes("kedah") if (WORK / f"kedah_{p['date_utc']}_water.tif").exists()]
    wet = None
    seen = None
    for i, d in enumerate(dates):
        w = load_tif(WORK / f"kedah_{d}_water.tif")["water"]
        if wet is None:
            wet = np.zeros(w.shape, np.uint8)
            seen = np.zeros(w.shape, np.uint8)
        wet |= ((w == 1).astype(np.uint8) << i)
        seen |= ((w != 255).astype(np.uint8) << i)
    rgba = [bake.warp(wet, "kedah", Resampling.nearest, np.uint8(0)), bake.warp(seen, "kedah", Resampling.nearest, np.uint8(0))]
    alpha = np.where(rgba[1] > 0, 255, 0).astype(np.uint8)
    bake.write_png(BAKED / "kedah_wetbits.webp", [rgba[0], rgba[1], np.zeros_like(alpha), alpha], lossless=True)
    log(f"baked kedah_wetbits.webp ({len(dates)} passes)")
    return {"url": "data/baked/kedah_wetbits.webp", "corners": bake.merc_grid("kedah")[3], "dates": dates}


def main() -> None:
    anc = load_tif(WORK / "kelantan_ancillary.tif")
    dist = anc["district"]
    with rasterio.open(WORK / "kelantan_ancillary.tif") as src:
        names = {int(k): v for k, v in json.loads(src.tags()["districts"]).items()}
    study = set(area("kelantan").get("study_districts", []))
    dates = [p["date_utc"] for p in passes("kelantan")]
    floods = {d: load_tif(WORK / f"kelantan_{d}_class.tif")["class"] == 3 for d in dates}

    # ---- 1. how long the water stayed ----
    count = np.zeros(dist.shape, np.uint8)
    run = np.zeros(dist.shape, np.uint8)
    longest = np.zeros(dist.shape, np.uint8)
    for d in dates:
        f = floods[d]
        count += f
        run = np.where(f, run + 1, 0).astype(np.uint8)
        longest = np.maximum(longest, run)
    dur = np.zeros(dist.shape, np.uint8)
    dur[count == 1] = 21
    dur[count == 2] = 22
    dur[count >= 3] = 23

    # ---- 2. people ----
    pop = population_on_grid()
    disk = np.hypot(*np.mgrid[-8:9, -8:9]) * 30 <= NEAR_M
    impact = {"population": "WorldPop 2024 constrained, 100 m (R2025A), CC BY 4.0", "near_m": NEAR_M,
              "pass_gap_days": 6, "dates": {}, "duration": {"districts": {}}, "district_population": {}}
    for i, info in names.items():
        inside = dist == i
        if inside.any():
            impact["district_population"][info["code"]] = round(float(pop[inside].sum()))
    for d in dates:
        f = floods[d]
        near = ndimage.binary_dilation(f, structure=disk) if f.any() else f
        rows = {}
        for i, info in names.items():
            inside = dist == i
            if not inside.any():
                continue
            rows[info["code"]] = {"people_in": round(float(pop[inside & f].sum())), "people_near": round(float(pop[inside & near].sum()))}
        st = [c for c, r in rows.items() if names[next(k for k, v in names.items() if v["code"] == c)]["district"] in study]
        impact["dates"][d] = {"people_in": sum(rows[c]["people_in"] for c in st), "people_near": sum(rows[c]["people_near"] for c in st), "districts": rows}
        log(f"{d}: about {impact['dates'][d]['people_near']:,} people within {NEAR_M} m of new flood water "
            f"({impact['dates'][d]['people_in']:,} inside it), study districts")
    for i, info in names.items():
        inside = dist == i
        if not inside.any():
            continue
        impact["duration"]["districts"][info["code"]] = {
            "district": info["district"], "study": info["district"] in study,
            "ha_1": round(float((inside & (count == 1)).sum() * HA)),
            "ha_2": round(float((inside & (count == 2)).sum() * HA)),
            "ha_3": round(float((inside & (count >= 3)).sum() * HA)),
            "ha_12days": round(float((inside & (longest >= 3)).sum() * HA)),
        }
    sd = [r for r in impact["duration"]["districts"].values() if r["study"]]
    impact["duration"]["total"] = {k: sum(r[k] for r in sd) for k in ("ha_1", "ha_2", "ha_3", "ha_12days")}
    log(f"duration, study districts: {impact['duration']['total']}")

    stats_path = WEB / "stats.json"
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    stats["kelantan"]["impact"] = impact
    stats["kedah"]["wetbits"] = kedah_wetbits(importlib.import_module("09_bake_web"))
    stats_path.write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")

    # ---- bake the duration picture and register the layer ----
    bake = importlib.import_module("09_bake_web")
    cfg = json.loads(LAYERS_JSON.read_text(encoding="utf-8"))
    layer = {
        "id": "kel_duration", "areas": ["kelantan"], "group": "group.flood", "name": "layer.kel_duration", "simple": True,
        "kind": "image", "status": "real", "url": "data/baked/kelantan_duration.webp", "dates": "static", "slot": "data",
        "on": False, "opacity": 0.9, "info": "info.kel_duration", "exclusive_with": ["kel_flood"],
        "classes": [{"code": 21, "name": "kel.class.dur1", "color": "#F6C77A", "confidence": "medium"},
                    {"code": 22, "name": "kel.class.dur2", "color": "#D97A0B", "confidence": "medium"},
                    {"code": 23, "name": "kel.class.dur3", "color": "#8C2D04", "confidence": "medium"}],
        "swatch": ["#F6C77A", "#D97A0B", "#8C2D04"], "abbr": "DU", "collection": "opera_rtc",
        "corners": bake.merc_grid("kelantan")[3],
    }
    pic = bake.warp(dur, "kelantan", Resampling.nearest, np.uint8(0))
    bake.class_png(BAKED / "kelantan_duration.webp", pic, bake.palette(layer, 235))
    ids = [l["id"] for l in cfg["layers"]]
    if "kel_duration" in ids:
        cfg["layers"][ids.index("kel_duration")] = layer
    else:
        cfg["layers"].insert(ids.index("kel_flood") + 1, layer)
    for l in cfg["layers"]:
        if l["id"] == "kel_flood":
            l["exclusive_with"] = sorted(set(l.get("exclusive_with", [])) | {"kel_duration"})
    LAYERS_JSON.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log("baked kelantan_duration.webp; layers.json has kel_duration")


if __name__ == "__main__":
    main()
