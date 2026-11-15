# How AI was used

We used AI (Claude, Anthropic, via Claude Code) for four things: brainstorming, research, data analysis and coding. The team chose the problem, the study areas and the questions, and reviewed the results.

- **Brainstorming.** Talking through ideas, approaches and the structure of the app with the team.
- **Research.** Finding and summarising sources on SAR, NISAR, OPERA products, the Kelantan floods and the MADA rice schedule. Every fact used in the app and report is cited to its original source.
- **Data analysis.** The "AI analysis" notes for the six focus districts (what the radar shows, and what to check next) were written from our own pipeline results (`public/data/stats.json`, `public/data/rain.json`). `pipeline/11_ai_analysis.py` stores them in `public/data/focus_areas.json` and fails if any number in the text cannot be found in, or recomputed from, those results files. The team has reviewed every note, and the app labels them "AI analysis · reviewed by the team".
- **Coding.** The web app and the Python pipeline, including the interface text in English and Bahasa Melayu. Method choices made on the real data (for example the Kedah thresholds and land-only scoring) are shown in the app's "How sure are we?" panel.

**Numbers.** No number in the app is produced by an AI model. Hectares, percentages, rainfall and agreement scores are computed by the pipeline scripts from NASA data; the AI analysis only quotes them.

**In the page.** No AI model runs in the web page.
