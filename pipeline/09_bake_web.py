"""09 · Web-ready pictures and the layer contract (plan 04 §4.7, adapted).

Each map is warped to EPSG:3857 (nearest for classes, bilinear for brightness) and written as a WebP picture that MapLibre
places with an `image` source by its four corners; layers.json gets kind=image, status=real, the corners and the
list of baked dates. Class colours come from layers.json, so the legend and the picture always match.
Brightness pictures are grey + alpha, with grey 1–255 spread linearly over the layer's `range` in dB, so the app can
read a pixel back as dB. Outputs: public/data/baked/*.webp and an updated public/data/layers.json.
Usage: python pipeline/09_bake_web.py
"""
import json

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from common import BAKED, LAYERS_JSON, WORK, grid, load_tif, log, passes

RES = 30.0  # metres in Web Mercator (about 30 m on the ground at 6°N)


def merc_grid(area_id: str):
    _, transform, width, height = grid(area_id)
    crs, *_ = grid(area_id)
    x0, y1 = transform.c, transform.f
    x1, y0 = x0 + width * transform.a, y1 + height * transform.e
    to_ll = Transformer.from_crs(crs, 4326, always_xy=True)
    lons, lats = zip(*(to_ll.transform(x, y) for x in (x0, x1) for y in (y0, y1)))
    to_m = Transformer.from_crs(4326, 3857, always_xy=True)
    mx0, my0 = to_m.transform(min(lons), min(lats))
    mx1, my1 = to_m.transform(max(lons), max(lats))
    w, h = int(np.ceil((mx1 - mx0) / RES)), int(np.ceil((my1 - my0) / RES))
    t = from_origin(mx0, my1, RES, RES)
    back = Transformer.from_crs(3857, 4326, always_xy=True)
    (lw, ln), (le, ls) = back.transform(mx0, my1), back.transform(mx0 + w * RES, my1 - h * RES)
    corners = [[round(lw, 6), round(ln, 6)], [round(le, 6), round(ln, 6)], [round(le, 6), round(ls, 6)], [round(lw, 6), round(ls, 6)]]
    return t, w, h, corners


def warp(a: np.ndarray, area_id: str, resampling, nodata):
    crs, transform, _, _ = grid(area_id)
    t, w, h, _ = merc_grid(area_id)
    out = np.full((h, w), nodata, dtype=a.dtype)
    reproject(a, out, src_transform=transform, src_crs=crs, src_nodata=nodata, dst_transform=t, dst_crs="EPSG:3857",
              dst_nodata=nodata, resampling=resampling)
    return out


def hex_rgb(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def write_png(path, bands: list[np.ndarray], lossless: bool = True) -> None:
    """Write a WebP picture (path keeps the .png stem in calls; the file is saved as .webp).

    Class maps are lossless, because the popup matches exact colours. Brightness pictures and the composite are lossy
    (quality 90) to keep the site small; a dB value read back from them can be off by about ±0.3 dB.
    """
    from PIL import Image

    arr = np.dstack([b.astype("uint8") for b in bands])
    mode = {2: "LA", 3: "RGB", 4: "RGBA"}[arr.shape[2]]
    img = Image.fromarray(arr, mode).convert("RGBA")
    out = path.with_suffix(".webp")
    img.save(out, "WEBP", lossless=lossless, quality=90 if not lossless else 100, method=6)


def class_png(path, codes: np.ndarray, colours: dict[int, tuple[int, int, int, int]]) -> None:
    rgba = [np.zeros(codes.shape, "uint8") for _ in range(4)]
    for code, (r, g, b, a) in colours.items():
        m = codes == code
        for band, v in zip(rgba, (r, g, b, a)):
            band[m] = v
    write_png(path, rgba)


def grey_png(path, db: np.ndarray, lo: float, hi: float) -> None:
    ok = np.isfinite(db)
    g = np.zeros(db.shape, "uint8")
    g[ok] = np.clip(1 + np.round((db[ok] - lo) / (hi - lo) * 254), 1, 255)
    write_png(path, [g, np.where(ok, 255, 0).astype("uint8")], lossless=False)


def palette(layer: dict, alpha: int = 255) -> dict[int, tuple[int, int, int, int]]:
    out = {}
    for c in layer.get("classes", []):
        if c.get("color") and c.get("style") != "none":
            out[c["code"]] = (*hex_rgb(c["color"]), 200 if c.get("style") == "hatch-fill" else alpha)
    return out


if __name__ == "__main__":
    cfg = json.loads(LAYERS_JSON.read_text(encoding="utf-8"))
    L = {l["id"]: l for l in cfg["layers"]}

    def mark(lid: str, url: str, dates: list[str] | None, area_id: str, **extra) -> None:
        l = L[lid]
        l.update({"kind": "image", "status": "real", "url": url, "corners": merc_grid(area_id)[3], **extra})
        l.pop("preview", None)
        l.pop("wms_layer", None) if lid == "ked_rgb" else None
        l.pop("stand_in_for", None)
        if dates is not None:
            l["baked_dates"] = dates
        log(f"  {lid}: {len(dates) if dates else 1} picture(s)")

    # ---- Kelantan ----
    kd = [p["date_utc"] for p in passes("kelantan") if (WORK / f"kelantan_{p['date_utc']}_class.tif").exists()]
    pal = palette(L["kel_flood"], 230)
    lo, hi = L["kel_vv"]["range"]
    for d in kd:
        cls = warp(load_tif(WORK / f"kelantan_{d}_class.tif")["class"], "kelantan", Resampling.nearest, np.uint8(0))
        class_png(BAKED / f"kelantan_{d}_class.webp", cls, pal)
        vv = warp(load_tif(WORK / f"kelantan_{d}_vv.tif")["VV_dB"], "kelantan", Resampling.bilinear, np.float32(np.nan))
        grey_png(BAKED / f"kelantan_{d}_vv.webp", vv, lo, hi)
    mark("kel_flood", "data/baked/kelantan_{date}_class.webp", kd, "kelantan")
    mark("kel_vv", "data/baked/kelantan_{date}_vv.webp", kd, "kelantan", encoding={"type": "grey", "range": [lo, hi]})

    # ---- Kedah ----
    ked = [p["date_utc"] for p in passes("kedah") if (WORK / f"kedah_{p['date_utc']}_db.tif").exists()]
    hh_lo, hh_hi = L["ked_hh"]["range"]
    hv_lo, hv_hi = L["ked_hv"]["range"]
    pool_hh, pool_hv, pool_r = [], [], []
    for d in ked:
        b = load_tif(WORK / f"kedah_{d}_db.tif")
        ok = np.isfinite(b["HH_dB"])
        pool_hh.append(b["HH_dB"][ok][::50]); pool_hv.append(b["HV_dB"][ok][::50]); pool_r.append((b["HH_dB"] - b["HV_dB"])[ok][::50])
    # One fixed stretch per channel for all dates and both stacks (plan 04 §4.5 step 2a): never stretch per date.
    stretch = {k: [round(float(np.percentile(np.concatenate(v), 2)), 1), round(float(np.percentile(np.concatenate(v), 98)), 1)]
               for k, v in (("R_HH", pool_hh), ("G_HV", pool_hv), ("B_HH_minus_HV", pool_r))}
    for d in ked:
        b = load_tif(WORK / f"kedah_{d}_db.tif")
        hh = warp(b["HH_dB"], "kedah", Resampling.bilinear, np.float32(np.nan))
        hv = warp(b["HV_dB"], "kedah", Resampling.bilinear, np.float32(np.nan))
        grey_png(BAKED / f"kedah_{d}_hh.webp", hh, hh_lo, hh_hi)
        grey_png(BAKED / f"kedah_{d}_hv.webp", hv, hv_lo, hv_hi)
        ok = np.isfinite(hh) & np.isfinite(hv)
        chans = []
        for arr, (s0, s1) in ((hh, stretch["R_HH"]), (hv, stretch["G_HV"]), (hh - hv, stretch["B_HH_minus_HV"])):
            chans.append(np.where(ok, np.clip((arr - s0) / (s1 - s0) * 255, 0, 255), 0))
        write_png(BAKED / f"kedah_{d}_rgb.webp", [*chans, np.where(ok, 255, 0)], lossless=False)
        dis_f = WORK / f"kedah_{d}_disagree.tif"
        if dis_f.exists():
            dis = warp(load_tif(dis_f)["disagree"], "kedah", Resampling.nearest, np.uint8(0))
            class_png(BAKED / f"kedah_{d}_disagree.webp", dis, {1: (*hex_rgb("#CC79A7"), 230), 2: (*hex_rgb("#56B4E9"), 230)})
    first = warp(load_tif(WORK / "kedah_first_flooded.tif")["first_flooded"], "kedah", Resampling.nearest, np.uint8(0))
    class_png(BAKED / "kedah_first_flooded.webp", first, palette(L["ked_first_flooded"], 235))
    mark("ked_hh", "data/baked/kedah_{date}_hh.webp", ked, "kedah", encoding={"type": "grey", "range": [hh_lo, hh_hi]})
    mark("ked_hv", "data/baked/kedah_{date}_hv.webp", ked, "kedah", encoding={"type": "grey", "range": [hv_lo, hv_hi]})
    mark("ked_rgb", "data/baked/kedah_{date}_rgb.webp", ked, "kedah", stretch=stretch, attribution="Our HH/HV composite from NISAR GCOV (NASA/JPL, via ASF DAAC)")
    mark("ked_first_flooded", "data/baked/kedah_first_flooded.webp", None, "kedah")
    dis_dates = [d for d in ked if (WORK / f"kedah_{d}_disagree.tif").exists()]
    if dis_dates:
        mark("ked_disagree", "data/baked/kedah_{date}_disagree.webp", dis_dates, "kedah",
             classes=[{"code": 1, "name": "ked.dis.nisar", "color": "#CC79A7", "confidence": "low"},
                      {"code": 2, "name": "ked.dis.dswx", "color": "#56B4E9", "confidence": "low"}])

    LAYERS_JSON.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(f.stat().st_size for f in BAKED.glob("*.webp"))
    log(f"baked {len(list(BAKED.glob('*.webp')))} pictures, {total / 1e6:.1f} MB; layers.json updated")

    # Provenance: every granule the maps were made from (plan 04 §4.1 item 4).
    from common import MANIFEST, WEB
    prov_path = WEB / "provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    used = []
    kel_m = json.loads((MANIFEST / "kelantan.json").read_text(encoding="utf-8"))
    for p in kel_m["passes"]:
        used += [{"area": "kelantan", "product": "OPERA RTC-S1 V1", "id": b["id"]} for b in p["rtc"]]
        used += [{"area": "kelantan", "product": "OPERA DSWx-S1 V1", "id": t["id"]} for t in p["dswx"]]
    ked_m = json.loads((MANIFEST / "kedah.json").read_text(encoding="utf-8"))
    used += [{"area": "kedah", "product": p["nisar"]["collection"], "id": p["nisar"]["id"]} for p in ked_m["passes"] if p["nisar"]]
    for c in ked_m["checks"]:
        used += [{"area": "kedah", "product": "OPERA DSWx-S1 V1", "id": t["id"]} for t in c["dswx"]]
    ids = {u["id"] for u in used}
    prov["_note"] = "Granules used by the pipeline (pipeline/09_bake_web.py), plus the newest NISAR passes found live on 14 Nov 2026."
    prov["granules"] = used + [g for g in prov["granules"] if g["id"] not in ids and "V1 (validated)" in g["product"]]
    prov_path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"provenance: {len(prov['granules'])} granules")
