# Radar water map

NASA Space Apps Challenge 2026 · **Dancing with the SARs**

An open-source web map that turns radar satellite data into numbers about water on the ground in Malaysia, seen through monsoon cloud:

- **Kelantan flood, Nov–Dec 2024.** New flood water by district from Sentinel-1 C-band radar (NASA OPERA RTC-S1), checked against NASA's OPERA DSWx-S1 water map.
- **Kedah paddy, Sep–Nov 2026.** When field water reached MADA's rice fields, from NISAR L-band HH/HV radar, compared with Sentinel-1 (a different radar).
- **Kelantan now (live).** NASA's newest water maps and NISAR pictures for this monsoon, read live from NASA. Imagery only.
- **Anywhere.** NASA's NISAR and OPERA pictures for any place and day, plus the newest NISAR pass in view.

What the map does beyond showing pictures:

- **This spot, pass by pass.** Click anywhere in a study district to see the radar brightness at that spot on every pass, with our map's verdict under each date. Kelantan: VV and the water limit. Kedah: HH (water) and HV (plants), so you can watch a field flood and then the rice grow.
- **How long the water stayed.** A Kelantan layer counting the passes (6 days apart) on which each spot held new flood water, with hectares per district.
- **People near the water.** WorldPop 2024 population within 250 m of new flood water, per district and pass, next to the evacuee counts from the news.
- **AI analysis with checked numbers.** Short notes per focus district written by AI from our results; `pipeline/11_ai_analysis.py` fails if any number does not match the results files.
- **Save a picture of this view.** A PNG of the map with a caption, the colour key and the data credits.
- **English and Bahasa Melayu.** The BM / EN button in the top bar switches the whole app, including the AI analysis (checked in both languages); links can carry `?lang=ms`.

It is a student prototype. It is not a warning service and has not been reviewed by NASA. For live river levels see [Public InfoBanjir (JPS)](https://publicinfobanjir.water.gov.my/); follow [NADMA](https://www.nadma.gov.my/) for evacuation.

## Project materials

- **Live map:** https://project-sars-amoeba.vercel.app
- **30-second demo:** https://www.youtube.com/watch?v=WaQ0PtXYlBY
- **Full project video (4 min):** https://www.youtube.com/watch?v=c9DjtSZXVVE
- **Project report (PDF):** [docs/report/Project_SARS_Amoeba_Report.pdf](docs/report/Project_SARS_Amoeba_Report.pdf)
- **Team SARS Amoeba:** Lee Wen Yi, Joo Eu-Jin, Tan Jia Shun, Ong Kah Weng

## Headline results (from our pipeline, 14 Nov 2026)

| | Result | Range |
|---|---|---|
| Kelantan, 29 Nov 2024 | about 20,300 ha of new flood water in the seven study districts; most in Pasir Puteh and Pasir Mas | 17,200–20,300 ha (threshold ±1 dB) |
| Kelantan, agreement with DSWx-S1 at the flood peak | F1 0.75, IoU 0.60 (land only, same radar: a consistency check) | F1 0.07–0.75 over six passes |
| Kedah, share of cropland with field water | 2% (23–25 Sep) → 7% (5–7 Oct) → 22% (17–19 Oct) → 45% (31 Oct) | ±1 dB on both thresholds |
| Kelantan, people within 250 m of new flood water, 29 Nov 2024 | about 244,000 (about 15,000 inside it), WorldPop 2024 | an exposure estimate, not a count of victims |
| Kelantan, land flooded on 2 or more passes | about 4,100 ha, most in Tumpat (1,377 ha) and Pasir Mas (1,231 ha) | passes 6 days apart |
| Kedah, agreement with DSWx-S1 | NISAR finds far more field water than Sentinel-1; almost all of Sentinel-1's water is inside ours | see "How sure are we?" in the app |

The two NISAR stacks (076 descending, 112 ascending) give nearly the same share on neighbouring dates (7.5% vs 6.1%, 22.4% vs 22.0%), although they look from opposite sides.

## Run the app

```powershell
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

The site is static: every page of data is a file in `public/data/`, and the live parts call NASA's public, login-free services (CMR, ASF Search API, GIBS) from the browser.

## Re-make the data

The pipeline is Python (`pipeline/`, plan 04). It needs a free [Earthdata Login](https://urs.earthdata.nasa.gov/) in a netrc file (`%USERPROFILE%\_netrc` on Windows). Credentials are read, never printed.

```powershell
pip install -r pipeline/requirements.txt
python pipeline/01_search.py         # pin granules → data/manifest/
python pipeline/02_fetch_opera.py    # OPERA RTC-S1 VV + masks, DSWx-S1 tiles (~1 GB)
python pipeline/03_fetch_nisar.py    # stream the Kedah window of each NISAR file (~450 MB each)
python pipeline/04_fetch_ancillary.py  # JRC water, ESA WorldCover, DOSM districts
python pipeline/05_kelantan_flood.py
python pipeline/06_kedah_paddy.py
python pipeline/07_validate.py
python pipeline/08_stats.py          # → public/data/stats.json
python pipeline/09_bake_web.py       # → public/data/baked/*.webp, updates layers.json
python pipeline/10_rainfall.py       # → public/data/rain.json (NASA IMERG if GES DISC is approved, else NASA POWER)
python pipeline/11_ai_analysis.py    # AI analysis text → focus_areas.json, with the number check
python pipeline/12_impact.py         # how long the water stayed, people near it (WorldPop), Kedah per-pass verdicts
```

Downloads and intermediate rasters go to `data/` (git-ignored). Each script prints a short check (thresholds, bimodality, hectares, % valid).

### Method in one paragraph per area

**Kelantan.** OPERA RTC-S1 bursts of one track are averaged onto a 30 m UTM 48N grid. Water = VV darker than an Otsu threshold (checked for two clear histogram peaks, Ashman D > 2), capped at HydroSAR's −15.5 dB; on every date Otsu came out above the cap, so −15.5 dB was used. New flood water = water now **and** a drop of more than 3 dB since the first pass of the same track. Normal water (JRC ≥ 80% or WorldCover water) is excluded, towns are flagged, layover/shadow is shown as "radar can't see here", and patches under 1 ha are removed. No slope or HAND mask.

**Kedah.** NISAR GCOV frequency A HH and HV are streamed for the study box only, averaged to 30 m in linear power, and tested on ESA WorldCover cropland. Field water = HH and HV both darker than thresholds from Otsu on the stack's most clearly two-peaked date (no C-band cap). The first-flooded map takes the earliest date across both stacks.

### Add your town

1. Add an area to `public/data/layers.json` (id, kind, bbox, dates, panel text keys) and its passes to `public/data/passes.json`.
2. Add a grid for it in `pipeline/common.py` (`GRIDS`: UTM EPSG and 30 m).
3. Run the pipeline scripts. Every script reads the area from `layers.json`; no box or date is typed into a script.

For imagery only, "Anywhere" and the "Newest NISAR picture" layer already work for any place NISAR covers.

## Data and credits

See [DATA_LICENSES.md](DATA_LICENSES.md). AI use is disclosed in [AI_USAGE.md](AI_USAGE.md).

## Licence

Code: MIT. Data: see each source's licence in DATA_LICENSES.md.
