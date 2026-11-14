"""01 · Pin the exact granules for both areas (plan 04 §4.1). Writes data/manifest/<area>.json.

Kelantan: OPERA RTC-S1 bursts (VV + mask) and DSWx-S1 tiles for every primary pass in passes.json.
Kedah: one NISAR GCOV granule per primary pass (frame 085 / 005, DHDH) and DSWx-S1 tiles for every Sentinel-1D pass.
Usage: python pipeline/01_search.py
"""
import json
import re
from datetime import datetime, timedelta

from common import MANIFEST, NISAR_COLLECTIONS, area, cmr_granules, https_urls, log, passes


def day_window(date_utc: str) -> tuple[str, str]:
    return f"{date_utc}T00:00:00Z", f"{date_utc}T23:59:59Z"


def latest_per_tile(items: list[dict]) -> list[dict]:
    """DSWx-S1 tiles are sometimes processed twice; keep the newest processing run of each tile and pass."""
    best: dict[str, dict] = {}
    for it in items:
        ur = it["umm"]["GranuleUR"]
        tile = ur.split("_")[3]
        acq = ur.split("_")[4][:13]
        prod = ur.split("_")[5]
        key = f"{tile}|{acq}"
        if key not in best or prod > best[key]["umm"]["GranuleUR"].split("_")[5]:
            best[key] = it
    return list(best.values())


def dswx_for(area_id: str, date_utc: str, time_utc: str) -> list[dict]:
    a = area(area_id)
    items = cmr_granules("OPERA_L3_DSWX-S1_V1", a["bbox"], *day_window(date_utc))
    t0 = datetime.fromisoformat(f"{date_utc}T{time_utc}")
    keep = []
    for it in latest_per_tile(items):
        acq = datetime.strptime(it["umm"]["GranuleUR"].split("_")[4][:15], "%Y%m%dT%H%M%S")
        if abs(acq - t0) <= timedelta(minutes=30):
            wtr = [u for u in https_urls(it) if u.endswith("_B01_WTR.tif")]
            if wtr:
                keep.append({"id": it["umm"]["GranuleUR"], "wtr": wtr[0]})
    return keep


def kelantan() -> dict:
    a = area("kelantan")
    out = {"area": "kelantan", "passes": []}
    for p in passes("kelantan"):
        items = cmr_granules("OPERA_L2_RTC-S1_V1", a["bbox"], *day_window(p["date_utc"]))
        bursts = []
        for it in items:
            ur = it["umm"]["GranuleUR"]
            if f"_{p['track']}-" not in ur:
                continue
            urls = https_urls(it)
            vv = next((u for u in urls if u.endswith("_VV.tif")), None)
            vh = next((u for u in urls if u.endswith("_VH.tif")), None)
            mask = next((u for u in urls if u.endswith("_mask.tif")), None)
            if vv and mask:
                bursts.append({"id": ur, "vv": vv, "vh": vh, "mask": mask})
        dswx = dswx_for("kelantan", p["date_utc"], p["time_utc"])
        log(f"kelantan {p['date_utc']} {p['track']}: {len(bursts)} RTC bursts, {len(dswx)} DSWx tiles")
        out["passes"].append({**p, "rtc": bursts, "dswx": dswx})
    return out


def kedah() -> dict:
    a = area("kedah")
    out = {"area": "kedah", "passes": [], "checks": []}
    for p in passes("kedah"):
        stack = p["track"]  # e.g. 076_D_085
        found = None
        for coll in NISAR_COLLECTIONS:
            for it in cmr_granules(coll, a["bbox"], *day_window(p["date_utc"])):
                ur = it["umm"]["GranuleUR"]
                if f"_{stack}_" in ur and "_DHDH_" in ur:
                    h5 = next((u for u in https_urls(it) if u.endswith(".h5")), None)
                    if h5:
                        found = {"id": ur, "h5": h5, "collection": coll}
                        break
            if found:
                break
        log(f"kedah {p['date_utc']} {stack}: {found['collection'] if found else 'NOT FOUND'}")
        out["passes"].append({**p, "nisar": found})
    for p in passes("kedah", primary_only=False):
        if p["sensor"] != "Sentinel-1D":
            continue
        dswx = dswx_for("kedah", p["date_utc"], p["time_utc"])
        log(f"kedah check {p['date_utc']} {p['track']}: {len(dswx)} DSWx tiles")
        out["checks"].append({**p, "dswx": dswx})
    return out


if __name__ == "__main__":
    for fn in (kelantan, kedah):
        m = fn()
        path = MANIFEST / f"{m['area']}.json"
        path.write_text(json.dumps(m, indent=1), encoding="utf-8")
        log(f"wrote {path}")
