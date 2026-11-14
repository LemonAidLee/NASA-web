"""10 · Daily rainfall over each study box, for the linked rainfall chart (plan 07 F13). Writes public/data/rain.json.

Source order:
1. NASA GPM IMERG daily V07 (Final run for 2024, Late run for 2026) through the GES DISC OPeNDAP service, reading only
   the study-box cells (0.1°). Needs an Earthdata login AND the "NASA GESDISC DATA ARCHIVE" application approved in the
   Earthdata profile; without that approval GES DISC answers 401/403.
2. Fallback: NASA POWER daily PRECTOTCORR (MERRA-2 reanalysis, bias-corrected, about 0.5° × 0.625°), no login,
   averaged over four points inside the box.
The file records which source was used; the app labels the chart with it.
Usage: python pipeline/10_rainfall.py
"""
import io
import json
import time
from datetime import date, timedelta

import numpy as np
import requests

from common import WEB, area, log, session

POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
IMERG = {
    # collection concept IDs of the daily V07 products (CMR, checked 14 Nov 2026)
    "final": ("C2723754864-GES_DISC", "GPM_3IMERGDF.07", "3B-DAY.MS.MRG.3IMERG.{d}-S000000-E235959.V07B.nc4"),
    "late": ("C2723754859-GES_DISC", "GPM_3IMERGDL.07", "3B-DAY-L.MS.MRG.3IMERG.{d}-S000000-E235959.V07B.nc4"),
}
WINDOWS = {"kelantan": ("2024-11-10", "2024-12-20", "final"), "kedah": ("2026-09-10", "2026-11-11", "late")}


def days(start: str, end: str) -> list[str]:
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    return [(d0 + timedelta(n)).isoformat() for n in range((d1 - d0).days + 1)]


def imerg_box(area_id: str, run: str, sess) -> dict[str, float]:
    import h5py

    coll, short, pattern = IMERG[run]
    w, s, e, n = area(area_id)["bbox"]
    lo0, lo1 = int((w + 180) / 0.1), int((e + 180) / 0.1)
    la0, la1 = int((s + 90) / 0.1), int((n + 90) / 0.1)
    out = {}
    for d in days(*WINDOWS[area_id][:2]):
        gran = f"{short}%3A{pattern.format(d=d.replace('-', ''))}"
        url = (f"https://opendap.earthdata.nasa.gov/collections/{coll}/granules/{gran}.dap.nc4"
               f"?dap4.ce=/precipitation[0][{lo0}:{lo1}][{la0}:{la1}]")
        r = sess.get(url, timeout=120)
        if r.status_code in (401, 403):
            raise PermissionError(f"IMERG via OPeNDAP refused ({r.status_code}); approve 'NASA GESDISC DATA ARCHIVE' in Earthdata")
        if r.status_code == 404:
            continue  # day not produced yet (Late run lag)
        r.raise_for_status()
        p = h5py.File(io.BytesIO(r.content), "r")["precipitation"][:].astype("float64")
        p[p < 0] = np.nan
        out[d] = round(float(np.nanmean(p)), 1)
    if not out:
        raise PermissionError("IMERG via OPeNDAP returned no days for this window")
    return out


def power_box(area_id: str) -> dict[str, float]:
    w, s, e, n = area(area_id)["bbox"]
    start, end, _ = WINDOWS[area_id]
    pts = [(w + (e - w) * fx, s + (n - s) * fy) for fx in (0.25, 0.75) for fy in (0.25, 0.75)]
    series = []
    for lon, lat in pts:
        for attempt in range(4):
            try:
                r = requests.get(POWER, params={
                    "parameters": "PRECTOTCORR", "community": "AG", "longitude": round(lon, 3), "latitude": round(lat, 3),
                    "start": start.replace("-", ""), "end": end.replace("-", ""), "format": "JSON",
                }, timeout=120)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt + 1))
        series.append(r.json()["properties"]["parameter"]["PRECTOTCORR"])
    out = {}
    for d in days(start, end):
        k = d.replace("-", "")
        vals = [s_[k] for s_ in series if k in s_ and s_[k] is not None and s_[k] > -900]
        if vals:
            out[d] = round(float(np.mean(vals)), 1)
    return out


if __name__ == "__main__":
    result = {"_note": "Daily rainfall, study-box average (mm/day). Made by pipeline/10_rainfall.py."}
    sess = session()
    for area_id, (start, end, run) in WINDOWS.items():
        try:
            daily = imerg_box(area_id, run, sess)
            src = {"name": f"NASA GPM IMERG daily V07 ({'Final' if run == 'final' else 'Late'} run)",
                   "short": "IMERG", "kind": "satellite", "resolution": "0.1°",
                   "doi": "10.5067/GPM/IMERGDF/DAY/07" if run == "final" else "10.5067/GPM/IMERGDL/DAY/07"}
        except PermissionError as err:
            log(f"{area_id}: {err}; using NASA POWER instead")
            daily = power_box(area_id)
            src = {"name": "NASA POWER daily precipitation (PRECTOTCORR, MERRA-2 reanalysis, bias-corrected)",
                   "short": "NASA POWER", "kind": "reanalysis", "resolution": "about 0.5° × 0.625°, 4 points averaged",
                   "url": "https://power.larc.nasa.gov/"}
        peak = max(daily.items(), key=lambda kv: kv[1]) if daily else (None, None)
        result[area_id] = {"source": src, "start": start, "end": end, "daily": daily, "peak": {"date": peak[0], "mm": peak[1]}}
        log(f"{area_id}: {len(daily)} days from {src['short']}; wettest {peak[0]} ({peak[1]} mm), total {sum(daily.values()):.0f} mm")
    (WEB / "rain.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    log(f"wrote {WEB / 'rain.json'}")
