"""06 · Kedah paddy flooding from NISAR L-band HH/HV (plan 04 §4.5).

Per stack (076_D_085 and 112_A_005 are classified separately, never mixing dB values):
water test W = HH < T_HH and HV < T_HV on cropland (WorldCover class 40). Thresholds: Otsu on cropland pixels of
the stack's most clearly bimodal date (highest Ashman D, must exceed 2; §4.6a), applied to every date of the stack.
No HydroSAR cap: its −15.5/−23 dB caps are C-band VV/VH values. Decisions are then merged across stacks: the
earliest date a field shows water wins.
Outputs in data/work/:
  kedah_<date>_db.tif (HH_dB, HV_dB), kedah_<date>_water.tif (1 = field water, 0 = dry cropland, 255 = not mapped),
  kedah_first_flooded.tif (codes below), kedah_paddy.json (thresholds, % field water per date).
First-flooded codes: 0 not mapped (not cropland / no data) · 1 cropland, no field water seen · 2 normal water (JRC ≥ 80%)
· 11 first seen 23–25 Sep · 12 first seen 5–7 Oct · 13 first seen 17–19 Oct · 14 first seen 31 Oct.
Usage: python pipeline/06_kedah_paddy.py
"""
import json

import numpy as np
from scipy import ndimage

from common import MANIFEST, WORK, load_tif, log, passes, save_tif, to_db, water_threshold

# Date groups for the first-flooded map: each group holds one pass from each stack, a few days apart.
GROUPS = [(11, ["2026-09-23", "2026-09-25"]), (12, ["2026-10-05", "2026-10-07"]), (13, ["2026-10-17", "2026-10-19"]), (14, ["2026-10-31"])]

if __name__ == "__main__":
    m = json.loads((MANIFEST / "kedah.json").read_text(encoding="utf-8"))
    anc = load_tif(WORK / "kedah_ancillary.tif")
    crop = anc["worldcover"] == 40
    permanent = ((anc["jrc"] >= 80) & (anc["jrc"] <= 100)) | (anc["worldcover"] == 80)
    paddy = crop & ~permanent

    dbs: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for p in m["passes"]:
        f = WORK / f"kedah_{p['date_utc']}_{p['track']}.tif"
        if not f.exists():
            log(f"missing {f.name}, skipped")
            continue
        b = load_tif(f)
        hh = ndimage.median_filter(np.nan_to_num(to_db(b["HH"]), nan=-99), size=3).astype("float32")
        hv = ndimage.median_filter(np.nan_to_num(to_db(b["HV"]), nan=-99), size=3).astype("float32")
        bad = ~np.isfinite(b["HH"]) | (hh < -60) | (hv < -60)
        hh[bad], hv[bad] = np.nan, np.nan
        dbs[p["date_utc"]] = (hh, hv)
        save_tif(WORK / f"kedah_{p['date_utc']}_db.tif", {"HH_dB": hh, "HV_dB": hv}, "kedah", nodata=np.nan, tags={"track": p["track"]})

    stacks: dict[str, list[str]] = {}
    for p in passes("kedah"):
        if p["date_utc"] in dbs:
            stacks.setdefault(p["track"], []).append(p["date_utc"])

    result = {"stacks": {}, "dates": {}}
    water: dict[str, np.ndarray] = {}
    for track, dates in stacks.items():
        # One threshold pair per stack, taken from the stack's date whose cropland histogram is most clearly
        # bimodal (both dry and flooded fields present). A dry-only date has one mode, and Otsu there is ill-posed
        # (§4.6a). HydroSAR's caps are C-band VV/VH values, so they are not applied to L-band HH/HV.
        best = None
        for d in dates:
            hh, hv = dbs[d]
            ok = paddy & np.isfinite(hh) & np.isfinite(hv)
            th = water_threshold(hh, ok, cap=np.inf)
            tv = water_threshold(hv, ok, cap=np.inf)
            score = min(th["ashman_d"], tv["ashman_d"])
            log(f"  {track} {d}: Otsu HH {th['threshold_db']} (D={th['ashman_d']}), HV {tv['threshold_db']} (D={tv['ashman_d']})")
            if best is None or score > best[0]:
                best = (score, d, th, tv)
        _, src_date, t_hh, t_hv = best
        if best[0] <= 2:
            log(f"  {track}: no date passes the bimodality check (D <= 2); thresholds are uncertain")
        result["stacks"][track] = {"HH": t_hh, "HV": t_hv, "dates": dates, "threshold_from": src_date, "bimodal": bool(best[0] > 2)}
        log(f"{track}: T_HH={t_hh['threshold_db']} dB, T_HV={t_hv['threshold_db']} dB, from {src_date} "
            f"(D={t_hh['ashman_d']}/{t_hv['ashman_d']})")
        for d in dates:
            hh, hv = dbs[d]
            ok = paddy & np.isfinite(hh)
            w = ok & (hh < t_hh["threshold_db"]) & (hv < t_hv["threshold_db"])
            water[d] = w
            wmap = np.full(hh.shape, 255, "uint8")
            wmap[ok] = 0
            wmap[w] = 1
            save_tif(WORK / f"kedah_{d}_water.tif", {"water": wmap}, "kedah", nodata=255)
            # ±1 dB sensitivity on both thresholds together.
            lo = ok & (hh < t_hh["threshold_db"] - 1) & (hv < t_hv["threshold_db"] - 1)
            hi = ok & (hh < t_hh["threshold_db"] + 1) & (hv < t_hv["threshold_db"] + 1)
            pct = 100 * w.sum() / max(ok.sum(), 1)
            result["dates"][d] = {
                "track": track, "pct_field_water": round(float(pct), 1),
                "pct_low": round(float(100 * lo.sum() / max(ok.sum(), 1)), 1),
                "pct_high": round(float(100 * hi.sum() / max(ok.sum(), 1)), 1),
                "water_ha": round(float(w.sum() * 0.09)), "paddy_ha_seen": round(float(ok.sum() * 0.09)),
                "hh_water_median_db": round(float(np.nanmedian(hh[w])), 2) if w.any() else None,
                "hh_land_median_db": round(float(np.nanmedian(hh[ok & ~w])), 2),
                "hv_water_median_db": round(float(np.nanmedian(hv[w])), 2) if w.any() else None,
                "hv_land_median_db": round(float(np.nanmedian(hv[ok & ~w])), 2),
            }
            log(f"  {d}: field water {pct:.1f}% of {ok.sum() * 0.09:,.0f} ha cropland seen")

    first = np.zeros(paddy.shape, "uint8")
    seen = np.zeros(paddy.shape, bool)
    for d, (hh, _) in dbs.items():
        seen |= paddy & np.isfinite(hh)
    first[seen] = 1
    first[crop & permanent] = 2
    for code, dates in reversed(GROUPS):  # earlier groups overwrite later ones: earliest wins
        hit = np.zeros(paddy.shape, bool)
        for d in dates:
            if d in water:
                hit |= water[d]
        first[hit] = code
    save_tif(WORK / "kedah_first_flooded.tif", {"first_flooded": first}, "kedah", nodata=0)
    result["first_flooded_ha"] = {str(c): round(float((first == c).sum() * 0.09)) for c in (1, 2, 11, 12, 13, 14)}
    (WORK / "kedah_paddy.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    log(f"first flooded (ha): {result['first_flooded_ha']}")
