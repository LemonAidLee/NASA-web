"""Shared settings and helpers for the pipeline (plan 04).

Areas come from public/data/layers.json, so the app and the pipeline read one config (plan 04 §4.0).
Earthdata credentials come from the user's netrc file (~/_netrc on Windows); they are never printed.
"""
from __future__ import annotations

import json
import netrc
import time
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
MANIFEST = ROOT / "data" / "manifest"
WEB = ROOT / "public" / "data"
BAKED = WEB / "baked"
for d in (RAW, WORK, MANIFEST, BAKED):
    d.mkdir(parents=True, exist_ok=True)

LAYERS_JSON = WEB / "layers.json"
PASSES_JSON = WEB / "passes.json"

URS = "urs.earthdata.nasa.gov"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"

# Processing grids: one UTM grid per area at 30 m (plan 04 §4.4 step 1, §4.5 step 2).
GRIDS = {
    "kelantan": {"epsg": 32648, "res": 30.0},
    "kedah": {"epsg": 32647, "res": 30.0},
}

# HydroSAR's caps on water thresholds (plan 04 §4.4 step 4): a ceiling, not a target.
CAP_VV = -15.5
CAP_VH = -23.0

# NISAR GCOV: validated collection from 21 Oct 2026, provisional before (CMR, checked 14 Nov 2026).
NISAR_COLLECTIONS = ["NISAR_L2_GCOV_V1", "NISAR_L2_GCOV_PROVISIONAL_V1"]


def config() -> dict:
    return json.loads(LAYERS_JSON.read_text(encoding="utf-8"))


def area(area_id: str) -> dict:
    return next(a for a in config()["areas"] if a["id"] == area_id)


def passes(area_id: str, primary_only: bool = True) -> list[dict]:
    rows = json.loads(PASSES_JSON.read_text(encoding="utf-8"))["passes"]
    return [p for p in rows if p["area"] == area_id and (p["primary"] or not primary_only)]


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ---------- Earthdata session ----------

class EarthdataSession(requests.Session):
    """Send credentials to URS only, on every redirect hop that reaches it.

    Some archives redirect more than once before login (ASF: datapool → cumulus → URS), so the header is
    re-attached whenever the next hop is URS and removed for every other host.
    """

    def rebuild_auth(self, prepared_request, response):
        host = requests.utils.urlparse(prepared_request.url).hostname
        prepared_request.headers.pop("Authorization", None)
        if host == URS and self.auth:
            prepared_request.prepare_auth(self.auth)


def netrc_path() -> str:
    home = Path.home()
    for name in ("_netrc", ".netrc"):
        if (home / name).exists():
            return str(home / name)
    raise SystemExit("No Earthdata netrc file found in the home folder.")


def session() -> EarthdataSession:
    auth = netrc.netrc(netrc_path()).authenticators(URS)
    if not auth:
        raise SystemExit(f"No {URS} entry in the netrc file.")
    s = EarthdataSession()
    s.auth = (auth[0], auth[2])
    return s


def download(url: str, dest: Path, sess: requests.Session, tries: int = 4) -> Path:
    """Resume-safe download: skip when the file exists and is not empty."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(tries):
        try:
            with sess.get(url, stream=True, timeout=180) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.replace(dest)
            return dest
        except requests.RequestException as e:
            if attempt == tries - 1:
                raise
            log(f"  retry {attempt + 1} for {dest.name}: {e}")
            time.sleep(3 * (attempt + 1))
    return dest


# ---------- CMR ----------

def cmr_granules(short_name: str, bbox: list[float], start: str, end: str) -> list[dict]:
    """All granules (UMM-G) of a collection over a box and time window."""
    out: list[dict] = []
    headers: dict[str, str] = {}
    while True:
        r = requests.get(CMR, params={
            "short_name": short_name,
            "bounding_box": ",".join(str(v) for v in bbox),
            "temporal": f"{start},{end}",
            "page_size": 2000,
            "sort_key": "start_date",
        }, headers=headers, timeout=120)
        r.raise_for_status()
        items = r.json().get("items", [])
        out += items
        after = r.headers.get("CMR-Search-After")
        if not after or not items:
            return out
        headers["CMR-Search-After"] = after


def https_urls(umm: dict) -> list[str]:
    return [u["URL"] for u in umm["umm"].get("RelatedUrls", []) if u.get("Type") == "GET DATA" and u["URL"].startswith("https")]


# ---------- grids ----------

def grid(area_id: str):
    """(crs, transform, width, height) of an area's processing grid, snapped to the resolution."""
    from pyproj import Transformer
    from rasterio.transform import from_origin

    g = GRIDS[area_id]
    w, s, e, n = area(area_id)["bbox"]
    tr = Transformer.from_crs(4326, g["epsg"], always_xy=True)
    xs, ys = zip(*(tr.transform(x, y) for x in (w, e) for y in (s, n)))
    res = g["res"]
    x0, x1 = np.floor(min(xs) / res) * res, np.ceil(max(xs) / res) * res
    y0, y1 = np.floor(min(ys) / res) * res, np.ceil(max(ys) / res) * res
    width, height = int((x1 - x0) / res), int((y1 - y0) / res)
    return f"EPSG:{g['epsg']}", from_origin(x0, y1, res, res), width, height


def save_tif(path: Path, arrays: dict[str, np.ndarray], area_id: str, nodata=None, tags: dict | None = None) -> None:
    import rasterio

    crs, transform, width, height = grid(area_id)
    first = next(iter(arrays.values()))
    with rasterio.open(path, "w", driver="GTiff", width=width, height=height, count=len(arrays), dtype=first.dtype,
                       crs=crs, transform=transform, nodata=nodata, compress="deflate", tiled=True) as dst:
        for i, (name, a) in enumerate(arrays.items(), start=1):
            dst.write(a, i)
            dst.set_band_description(i, name)
        if tags:
            dst.update_tags(**{k: str(v) for k, v in tags.items()})


def load_tif(path: Path) -> dict[str, np.ndarray]:
    import rasterio

    with rasterio.open(path) as src:
        return {src.descriptions[i] or f"b{i + 1}": src.read(i + 1) for i in range(src.count)}


def to_db(lin: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(lin > 0, 10 * np.log10(lin), np.nan).astype("float32")


# ---------- thresholds (plan 04 §4.6a) ----------

def otsu(values: np.ndarray, bins: int = 256) -> float:
    v = values[np.isfinite(values)]
    hist, edges = np.histogram(v, bins=bins)
    centres = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centres) / np.maximum(w0, 1)
    m1 = (np.sum(hist * centres) - np.cumsum(hist * centres)) / np.maximum(w1, 1)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(centres[np.argmax(between)])


def ashman_d(values: np.ndarray, t: float) -> float:
    """Ashman D of the two classes either side of a threshold; D > 2 = clear bimodality (OPERA DSWx ATBD)."""
    v = values[np.isfinite(values)]
    a, b = v[v < t], v[v >= t]
    if len(a) < 10 or len(b) < 10:
        return 0.0
    return float(np.sqrt(2) * abs(a.mean() - b.mean()) / np.sqrt(a.var() + b.var()))


def tile_threshold(db: np.ndarray, valid: np.ndarray, tile: int = 100, n_low: int = 4) -> tuple[float, int]:
    """HydroSAR-style fallback (plan 04 §4.6a): Otsu on the most variable dark tiles, median of the lowest few."""
    h, w = db.shape
    cands = []
    for r in range(0, h - tile + 1, tile):
        for c in range(0, w - tile + 1, tile):
            t = db[r:r + tile, c:c + tile]
            ok = valid[r:r + tile, c:c + tile] & np.isfinite(t)
            if ok.mean() < 0.8:
                continue
            q = [np.nanmean(np.where(ok, t, np.nan)[i:i + tile // 2, j:j + tile // 2]) for i in (0, tile // 2) for j in (0, tile // 2)]
            med = np.nanmedian(np.where(ok, t, np.nan))
            cands.append((np.nanstd(q) / abs(med) if med else 0, med, r, c))
    if not cands:
        return float("nan"), 0
    overall = np.nanmedian(db[valid])
    cands = [x for x in cands if x[1] < overall] or cands
    cands.sort(key=lambda x: -x[0])
    picked = cands[:max(5, len(cands) // 20)]
    th = sorted(otsu(db[r:r + tile, c:c + tile][valid[r:r + tile, c:c + tile]]) for _, _, r, c in picked)
    return float(np.median(th[:n_low])), len(picked)


def water_threshold(db: np.ndarray, valid: np.ndarray, cap: float) -> dict:
    """Otsu with the bimodality check, tile fallback and HydroSAR cap. Returns the threshold and how it was chosen."""
    v = db[valid & np.isfinite(db)]
    t = otsu(v)
    d = ashman_d(v, t)
    how = "otsu"
    if d <= 2:
        t2, n = tile_threshold(db, valid & np.isfinite(db))
        if np.isfinite(t2):
            t, how = t2, f"tile-based, {n} tiles"
            d = ashman_d(v, t)
    capped = t > cap
    if capped:
        t = cap
    return {"threshold_db": round(t, 2), "ashman_d": round(d, 2), "method": how, "capped": bool(capped), "n_pixels": int(v.size)}
