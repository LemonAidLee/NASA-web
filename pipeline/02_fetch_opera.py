"""02 · Download OPERA files listed in the manifests (plan 04 §4.2). Resume-safe.

Kelantan: RTC-S1 VV + mask per burst, DSWx-S1 B01_WTR per tile. Kedah: DSWx-S1 B01_WTR per tile for the check passes.
Usage: python pipeline/02_fetch_opera.py
"""
import json
from concurrent.futures import ThreadPoolExecutor

from common import MANIFEST, RAW, download, log, session


def jobs():
    kel = json.loads((MANIFEST / "kelantan.json").read_text(encoding="utf-8"))
    for p in kel["passes"]:
        for b in p["rtc"]:
            for k in ("vv", "mask"):
                yield b[k], RAW / "rtc" / b[k].rsplit("/", 1)[1]
        for t in p["dswx"]:
            yield t["wtr"], RAW / "dswx" / t["wtr"].rsplit("/", 1)[1]
    ked = json.loads((MANIFEST / "kedah.json").read_text(encoding="utf-8"))
    for p in ked["checks"]:
        for t in p["dswx"]:
            yield t["wtr"], RAW / "dswx" / t["wtr"].rsplit("/", 1)[1]


if __name__ == "__main__":
    s = session()
    todo = list(jobs())
    log(f"{len(todo)} files")
    done = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for path in ex.map(lambda j: download(j[0], j[1], s), todo):
            done += 1
            if done % 20 == 0 or done == len(todo):
                log(f"  {done}/{len(todo)}")
    total = sum(p.stat().st_size for _, p in todo if p.exists())
    log(f"done: {total / 1e6:.0f} MB on disk")
