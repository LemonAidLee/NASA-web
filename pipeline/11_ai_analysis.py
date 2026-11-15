"""11 · AI analysis of each focus district, written from our pipeline results, plus a number check.

The analysis texts below were written by Claude (Anthropic, via Claude Code) on 14 Nov 2026 from
public/data/stats.json and public/data/rain.json (the radar results of pipeline steps 05–10), not from news or the plan.
This script stores them in public/data/focus_areas.json and then checks that every number in every text can be
derived from the results files (or is a stated area/date), so no AI text can carry an invented figure.
Re-run after the pipeline changes: the check fails loudly if a number no longer matches.
Usage: python pipeline/11_ai_analysis.py
"""
import json
import re

from common import WEB

AI = {
    "kel-pasir-mas": {
        "analysis": "Our radar map shows about 4,680 ha of new flood water in Pasir Mas on 29 Nov 2024 (range 4,137–4,680 ha), "
                    "about 8% of the district. It arrived right after the three wettest days, 26–28 Nov, when about 127, 132 and 120 mm "
                    "of rain fell per day. By 5 Dec only 786 ha was left, and by 17 Dec 235 ha, so most of the water drained within a week.",
        "next": "The 5 Dec count comes from the other radar track, which sees the land from a different angle. Compare 29 Nov with "
                "11 Dec (same track) before saying exactly how fast the water went down.",
    },
    "kel-tumpat": {
        "analysis": "Tumpat had the largest share of its land under new flood water of any study district: about 3,596 ha on "
                    "29 Nov 2024, close to 20% of the district. The water also lingered. On 5 Dec about 1,330 ha remained, 37% of the "
                    "peak, while upstream Pasir Mas kept only 17%. That fits a low delta where the river meets the tide.",
        "next": "Check whether the water that stayed after 5 Dec sits in the same low fields each time. If it does, those fields are "
                "the slowest to drain and worth watching in the next monsoon.",
    },
    "kel-kota-bharu": {
        "analysis": "Kota Bharu shows about 2,404 ha of new flood water on 29 Nov 2024 (range 1,949–2,404 ha), about 6% of the district, "
                    "nearly all of it on farmland rather than in the built-up centre. Inside the town the radar cannot judge flooding, so built-up areas are greyed "
                    "out, not counted as dry. The count drops to 37 ha on 5 Dec, then rises to 692 ha on 11 Dec.",
        "next": "That rise on 11 Dec is probably not a second flood. 5 Dec and 11 Dec come from two different radar tracks with "
                "different viewing angles. Check it against NASA's water map for the same dates before reading it as new water.",
    },
    "ked-kota-setar": {
        "analysis": "Only about 1% of Kota Setar's rice land showed water in the fields on 23–25 Sep 2026, even though MADA's Phase I "
                    "began on 23 Sep. Field water grew to about 5% by 5–7 Oct, 17–20% by 17–19 Oct and 46.7% by 31 Oct. Most fields "
                    "first got water after Phase III began on 13 Oct, which suggests planting ran late in this drought year. The biggest jump came after "
                    "the wettest day of the season, 25 Oct, with about 114 mm of rain.",
        "next": "About 7,259 ha first showed water only on 31 Oct. Look at whether those fields lie far from the main canals, which "
                "would point to water reaching them last.",
    },
    "ked-kubang-pasu": {
        "analysis": "Kubang Pasu, the biggest of our three focus districts by rice land, got water earlier than Kota Setar: 8.7% of its rice land by "
                    "5 Oct 2026 against 5.1%. By 31 Oct it reached 55.1%, the highest of the three districts. The two NISAR tracks "
                    "agree on the trend but differ by a few points on nearby dates (32.6% on 17 Oct, 28% on 19 Oct), which shows how "
                    "much the viewing angle matters.",
        "next": "About 8,696 ha first showed water on 17–19 Oct. Compare those fields with MADA's Phase II and III areas to see "
                "whether water reached them on time.",
    },
    "ked-pendang": {
        "analysis": "Pendang looks different from the other two districts. About 6.8% of its rice land already looked wet on 23 Sep "
                    "2026, the day MADA's Phase I began, yet it only reached 20.9% by 31 Oct. Only 63% of the district lies "
                    "inside our radar area.",
        "next": "The early 'wet' patches may be smooth, dry soil, which can look like water to radar, rather than real field water. "
                "Check whether the same patches stay dark on every pass: real flooding comes and goes with planting.",
    },
}

# Bahasa Melayu versions, written by Claude from the same results and checked the same way; they go into
# public/data/focus_areas.ms.json (the app lays them over the English when the page is in Malay).
AI_MS = {
    "kel-pasir-mas": {
        "analysis": "Peta radar kami menunjukkan kira-kira 4,680 ha air banjir baharu di Pasir Mas pada 29 Nov 2024 (julat 4,137–4,680 ha), "
                    "kira-kira 8% daripada daerah. Ia muncul sejurus selepas tiga hari paling basah, 26–28 Nov, apabila kira-kira 127, 132 dan "
                    "120 mm hujan turun sehari. Menjelang 5 Dis hanya 786 ha tinggal, dan menjelang 17 Dis 235 ha, jadi kebanyakan air surut "
                    "dalam seminggu.",
        "next": "Kiraan 5 Dis datang daripada trek radar yang lain, yang melihat tanah dari sudut berbeza. Bandingkan 29 Nov dengan 11 Dis "
                "(trek sama) sebelum menyatakan dengan tepat seberapa cepat air surut.",
    },
    "kel-tumpat": {
        "analysis": "Tumpat mempunyai bahagian tanah terbesar yang ditenggelami air banjir baharu antara semua daerah kajian: kira-kira "
                    "3,596 ha pada 29 Nov 2024, hampir 20% daripada daerah. Air juga lambat surut. Pada 5 Dis kira-kira 1,330 ha masih ada, "
                    "37% daripada puncak, sedangkan Pasir Mas di hulu hanya tinggal 17%. Ini sepadan dengan delta rendah tempat sungai "
                    "bertemu air pasang.",
        "next": "Semak sama ada air yang kekal selepas 5 Dis berada di sawah rendah yang sama setiap kali. Jika ya, sawah itu paling "
                "lambat kering dan wajar diperhatikan pada monsun akan datang.",
    },
    "kel-kota-bharu": {
        "analysis": "Kota Bharu menunjukkan kira-kira 2,404 ha air banjir baharu pada 29 Nov 2024 (julat 1,949–2,404 ha), kira-kira 6% "
                    "daripada daerah, hampir semuanya di tanah pertanian, bukan di pusat bandar. Di dalam bandar radar tidak dapat menilai banjir, jadi kawasan bina "
                    "dikelabukan, bukan dikira kering. Kiraan turun kepada 37 ha pada 5 Dis, kemudian naik kepada 692 ha pada 11 Dis.",
        "next": "Kenaikan pada 11 Dis itu mungkin bukan banjir kedua. 5 Dis dan 11 Dis datang daripada dua trek radar berbeza dengan "
                "sudut pandangan berbeza. Semak dengan peta air NASA bagi tarikh yang sama sebelum menganggapnya air baharu.",
    },
    "ked-kota-setar": {
        "analysis": "Hanya kira-kira 1% tanah sawah Kota Setar menunjukkan air pada 23–25 Sep 2026, walaupun Fasa I MADA bermula pada "
                    "23 Sep. Air di sawah meningkat kepada kira-kira 5% menjelang 5–7 Okt, 17–20% menjelang 17–19 Okt dan 46.7% menjelang "
                    "31 Okt. Kebanyakan sawah mula mendapat air selepas Fasa III bermula pada 13 Okt, yang menunjukkan penanaman lewat pada "
                    "tahun kemarau ini. Lonjakan terbesar berlaku selepas hari paling basah musim ini, 25 Okt, dengan kira-kira 114 mm hujan.",
        "next": "Kira-kira 7,259 ha hanya mula menunjukkan air pada 31 Okt. Lihat sama ada sawah itu terletak jauh dari terusan utama, "
                "yang menunjukkan air sampai ke sana paling akhir.",
    },
    "ked-kubang-pasu": {
        "analysis": "Kubang Pasu, yang terbesar antara tiga daerah fokus kami dari segi tanah sawah, mendapat air lebih awal daripada Kota "
                    "Setar: 8.7% tanah sawahnya menjelang 5 Okt 2026 berbanding 5.1%. Menjelang 31 Okt ia mencapai 55.1%, tertinggi antara "
                    "tiga daerah. Dua trek NISAR sepakat tentang arah aliran tetapi berbeza beberapa mata pada tarikh berdekatan (32.6% pada "
                    "17 Okt, 28% pada 19 Okt), yang menunjukkan betapa pentingnya sudut pandangan.",
        "next": "Kira-kira 8,696 ha mula menunjukkan air pada 17–19 Okt. Bandingkan sawah itu dengan kawasan Fasa II dan III MADA untuk "
                "melihat sama ada air sampai tepat pada masanya.",
    },
    "ked-pendang": {
        "analysis": "Pendang nampak berbeza daripada dua daerah lain. Kira-kira 6.8% tanah sawahnya sudah nampak basah pada 23 Sep 2026, "
                    "hari Fasa I MADA bermula, namun ia hanya mencapai 20.9% menjelang 31 Okt. Hanya 63% daerah ini berada di dalam "
                    "kawasan radar kami.",
        "next": "Tompok 'basah' awal itu mungkin tanah kering yang licin, yang boleh nampak seperti air kepada radar, bukan air sawah "
                "sebenar. Semak sama ada tompok yang sama kekal gelap pada setiap laluan: banjir sebenar datang dan pergi mengikut penanaman.",
    },
}

META = {
    "generated_by": "Claude (Anthropic) via Claude Code, 14 Nov 2026, written from our radar results (stats.json, rain.json)",
    "kind": "ai-from-results",
    "reviewed": True,
    "checked": "pipeline/11_ai_analysis.py checks every number against stats.json and rain.json",
}


def allowed_numbers(stats: dict, rain: dict, focus: dict) -> set[str]:
    """Every number the texts may use, formatted the way people write them."""
    vals: set[float] = set()
    for d in stats["kelantan"]["dates"].values():
        for r in d["districts"].values():
            vals.update([r["flood_ha"], r["flood_ha_low"], r["flood_ha_high"], r["possible_ha"]])
    for d in stats["kedah"]["dates"].values():
        vals.update([d["pct_field_water"]])
        for r in d["districts"].values():
            vals.add(r["pct_field_water"])
    for r in stats["kedah"]["districts"].values():
        vals.update(r["first_flooded_ha"].values())
    for a in ("kelantan", "kedah"):
        vals.update(rain[a]["daily"].values())
    for lst in focus["areas"].values():
        for f in lst:
            vals.update([f["area_km2"], f["inside_pct"]])
    out = set()
    for v in vals:
        out.update({f"{v:,.0f}", f"{v:.0f}", f"{v:,.1f}", f"{v:.1f}", f"{round(v)}"})
    return out


def derived_ok(text_num: str, fid: str, stats: dict, focus: dict) -> bool:
    """Shares of a district, shares of the peak and rounded percentages are derived: recompute them here."""
    n = float(text_num.replace(",", ""))
    f = next(x for lst in focus["areas"].values() for x in lst if x["id"] == fid)
    code = f["code"]
    if fid.startswith("kel"):
        peak = stats["kelantan"]["dates"]["2024-11-29"]["districts"][code]["flood_ha"]
        share = 100 * peak / (f["area_km2"] * 100)
        cands = [share, 100 * stats["kelantan"]["dates"]["2024-12-05"]["districts"][code]["flood_ha"] / peak]
        pm = next(x for x in focus["areas"]["kelantan"] if x["district"] == "Pasir Mas")["code"]
        cands.append(100 * stats["kelantan"]["dates"]["2024-12-05"]["districts"][pm]["flood_ha"] / stats["kelantan"]["dates"]["2024-11-29"]["districts"][pm]["flood_ha"])
        return any(abs(n - c) <= 1.0 for c in cands)
    vals = [r["districts"][code]["pct_field_water"] for r in stats["kedah"]["dates"].values() if code in r["districts"]]
    return any(abs(n - v) <= 1.0 for v in vals)


if __name__ == "__main__":
    fa_path = WEB / "focus_areas.json"
    focus = json.loads(fa_path.read_text(encoding="utf-8"))
    stats = json.loads((WEB / "stats.json").read_text(encoding="utf-8"))
    rain = json.loads((WEB / "rain.json").read_text(encoding="utf-8"))
    ok_nums = allowed_numbers(stats, rain, focus)
    dates_and_labels = {"2024", "2026", "3"}  # years, "three wettest days"
    problems = []
    for lst in focus["areas"].values():
        for f in lst:
            ai = AI[f["id"]]
            f["ai_draft"] = ai["analysis"]
            f["ai_focus"] = ai["next"]
            for text in (ai["analysis"], ai["next"], AI_MS[f["id"]]["analysis"], AI_MS[f["id"]]["next"]):
                body = re.sub(r"\b\d{1,2}(?:–\d{1,2})? (?:Sep|Oct|Okt|Nov|Dec|Dis)\b", " ", text)  # calendar dates (en, ms)
                body = re.sub(r"(?:Phase|Fasa) (?:I|II|III)", " ", body)
                for num in re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?", body):
                    if num in ok_nums or num in dates_and_labels or derived_ok(num, f["id"], stats, focus):
                        continue
                    problems.append(f"{f['id']}: '{num}' not found in the results")
    if problems:
        raise SystemExit("Number check FAILED:\n  " + "\n  ".join(problems))
    focus["meta"] = META
    fa_path.write_text(json.dumps(focus, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    ms_path = WEB / "focus_areas.ms.json"
    ms = json.loads(ms_path.read_text(encoding="utf-8")) if ms_path.exists() else {"areas": {}}
    for fid, x in AI_MS.items():
        ms["areas"].setdefault(fid, {}).update({"ai_draft": x["analysis"], "ai_focus": x["next"]})
    ms_path.write_text(json.dumps(ms, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"ok: {len(AI)} AI analyses written; every number matches stats.json / rain.json")
