"""08 · District numbers for the app (plan 04 §4.6). Writes public/data/stats.json.

Kelantan, per pass and DOSM district: new flood water (class 3), possible flood (class 4), normal water, change since
the previous pass, and the range from moving the water threshold by ±1 dB. Pixel area = 900 m² (30 m grid).
Kedah, per pass and district: % of cropland with field water (and the ±1 dB range), and first-flooded hectares.
Usage: python pipeline/08_stats.py
"""
import json

import numpy as np
import rasterio

from common import WEB, WORK, area, load_tif, log, passes

HA = 0.09  # hectares per 30 m pixel


def lookup(area_id: str) -> dict[int, dict]:
    with rasterio.open(WORK / f"{area_id}_ancillary.tif") as src:
        return {int(k): v for k, v in json.loads(src.tags()["districts"]).items()}


def confidence(ha: float, lo: float, hi: float) -> str:
    """How much the number moves when the threshold moves by ±1 dB (our rule, stated in the app)."""
    if ha < 1:
        return "none"
    spread = (hi - lo) / ha
    return "high" if spread < 0.3 else "medium" if spread < 0.7 else "low"


def kelantan() -> dict:
    anc = load_tif(WORK / "kelantan_ancillary.tif")
    dist = anc["district"]
    names = lookup("kelantan")
    study = set(area("kelantan").get("study_districts", []))
    thr = json.loads((WORK / "kelantan_thresholds.json").read_text(encoding="utf-8"))
    out = {"dates": {}, "districts": {}}
    prev: dict[str, float] = {}
    for p in passes("kelantan"):
        d = p["date_utc"]
        cls = load_tif(WORK / f"kelantan_{d}_class.tif")["class"]
        sens = load_tif(WORK / f"kelantan_{d}_sens.tif")
        rows = {}
        for i, info in names.items():
            inside = dist == i
            if not inside.any():
                continue
            ha = float((cls[inside] == 3).sum() * HA)
            lo = float(sens["flood_hi"][inside].sum() * HA)  # higher threshold catches more water: upper bound
            hi_ = float(sens["flood_lo"][inside].sum() * HA)
            lo, hi_ = min(lo, hi_, ha), max(lo, hi_, ha)
            rows[info["code"]] = {
                "district": info["district"], "study": info["district"] in study,
                "flood_ha": round(ha), "flood_ha_low": round(lo), "flood_ha_high": round(hi_),
                "possible_ha": round(float((cls[inside] == 4).sum() * HA)),
                "permanent_ha": round(float((cls[inside] == 2).sum() * HA)),
                "change_ha": round(ha - prev[info["code"]]) if info["code"] in prev else None,
                "confidence": confidence(ha, lo, hi_),
            }
        for code, r in rows.items():
            prev[code] = r["flood_ha"]
        study_rows = [r for r in rows.values() if r["study"]]
        out["dates"][d] = {
            "date_myt": p["date_myt"], "track": p["track"], "reference": thr[d]["reference"],
            "threshold_db": thr[d]["threshold_db"], "threshold_method": thr[d]["method"], "capped": thr[d]["capped"],
            "flood_ha": sum(r["flood_ha"] for r in study_rows),
            "flood_ha_low": sum(r["flood_ha_low"] for r in study_rows),
            "flood_ha_high": sum(r["flood_ha_high"] for r in study_rows),
            "possible_ha": sum(r["possible_ha"] for r in study_rows),
            "top_district": max(study_rows, key=lambda r: r["flood_ha"])["district"] if study_rows else None,
            "water_median_db": thr[d]["water_median_db"], "land_median_db": thr[d]["land_median_db"],
            "districts": rows,
        }
        log(f"kelantan {d}: study area {out['dates'][d]['flood_ha']:,} ha new flood water "
            f"({out['dates'][d]['flood_ha_low']:,}–{out['dates'][d]['flood_ha_high']:,}); most in {out['dates'][d]['top_district']}")
    return out


def kedah() -> dict:
    anc = load_tif(WORK / "kedah_ancillary.tif")
    dist = anc["district"]
    names = lookup("kedah")
    study = set(area("kedah").get("study_districts", []))
    res = json.loads((WORK / "kedah_paddy.json").read_text(encoding="utf-8"))
    out = {"dates": {}, "first_flooded_ha": res["first_flooded_ha"], "stacks": res["stacks"], "districts": {}}
    for p in passes("kedah"):
        d = p["date_utc"]
        f = WORK / f"kedah_{d}_water.tif"
        if not f.exists():
            continue
        w = load_tif(f)["water"]
        rows = {}
        for i, info in names.items():
            seen = (dist == i) & (w != 255)
            if seen.sum() < 100:
                continue
            rows[info["code"]] = {"district": info["district"], "study": info["district"] in study,
                                  "pct_field_water": round(float(100 * (w[seen] == 1).mean()), 1),
                                  "cropland_ha_seen": round(float(seen.sum() * HA))}
        out["dates"][d] = {**res["dates"][d], "date_myt": p["date_myt"], "districts": rows}
    first = load_tif(WORK / "kedah_first_flooded.tif")["first_flooded"]
    for i, info in names.items():
        inside = dist == i
        crop = inside & np.isin(first, (1, 11, 12, 13, 14))
        if crop.sum() < 100:
            continue
        out["districts"][info["code"]] = {
            "district": info["district"], "study": info["district"] in study,
            "cropland_ha": round(float(crop.sum() * HA)),
            "first_flooded_ha": {str(c): round(float((first[inside] == c).sum() * HA)) for c in (11, 12, 13, 14)},
        }
    for d, r in out["dates"].items():
        log(f"kedah {d}: {r['pct_field_water']}% field water ({r['pct_low']}–{r['pct_high']}%)")
    return out


def hist(values: np.ndarray, lo: float, hi: float, step: float = 0.5) -> dict:
    """Share of pixels (%) per brightness bin; the chart in "How sure are we?" draws these."""
    v = values[np.isfinite(values)]
    edges = np.arange(lo, hi + step / 2, step)
    counts, _ = np.histogram(np.clip(v, lo, hi - 1e-6), bins=edges)
    return {"lo": lo, "step": step, "pct": [round(float(c), 3) for c in 100 * counts / max(v.size, 1)], "n": int(v.size)}


def histograms() -> dict:
    out: dict = {}
    kanc = load_tif(WORK / "kelantan_ancillary.tif")
    land = ~(((kanc["jrc"] >= 80) & (kanc["jrc"] <= 100)) | (kanc["worldcover"] == 80))
    thr = json.loads((WORK / "kelantan_thresholds.json").read_text(encoding="utf-8"))
    kel = {}
    for d in ("2024-11-17", "2024-11-29"):
        vv = load_tif(WORK / f"kelantan_{d}_vv.tif")["VV_dB"]
        cls = load_tif(WORK / f"kelantan_{d}_class.tif")["class"]
        kel[d] = hist(vv[land & (cls != 6) & np.isfinite(vv)], -30.0, 0.0)
    out["kelantan"] = {"band": "VV", "where": "land (normal water left out)", "threshold_db": thr["2024-11-29"]["threshold_db"], "dates": kel}
    danc = load_tif(WORK / "kedah_ancillary.tif")
    paddy = (danc["worldcover"] == 40) & ~(((danc["jrc"] >= 80) & (danc["jrc"] <= 100)) | (danc["worldcover"] == 80))
    res = json.loads((WORK / "kedah_paddy.json").read_text(encoding="utf-8"))
    st = res["stacks"]["112_A_005"]
    ked = {"HH": {}, "HV": {}}
    for d in ("2026-09-25", "2026-10-31"):
        b = load_tif(WORK / f"kedah_{d}_db.tif")
        ked["HH"][d] = hist(b["HH_dB"][paddy], -30.0, 0.0)
        ked["HV"][d] = hist(b["HV_dB"][paddy], -40.0, -5.0)
    out["kedah"] = {"stack": "112_A_005", "where": "cropland (ESA WorldCover)",
                    "threshold_db": {"HH": st["HH"]["threshold_db"], "HV": st["HV"]["threshold_db"]}, "dates": ked}
    return out


if __name__ == "__main__":
    val = json.loads((WORK / "validation.json").read_text(encoding="utf-8")) if (WORK / "validation.json").exists() else {}
    stats = {"_note": "Made by pipeline/08_stats.py from our radar maps. Hectares are 30 m pixels × 0.09 ha; ranges come from moving the water threshold by ±1 dB.",
             "kelantan": kelantan(), "kedah": kedah(), "validation": val, "histograms": histograms()}
    (WEB / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")
    log(f"wrote {WEB / 'stats.json'}")
