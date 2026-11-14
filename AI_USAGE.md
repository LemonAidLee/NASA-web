# How AI was used

- **Code.** The web app and the Python pipeline were written with Claude Code (Anthropic), working from the team's written plan and reviewed by the team. Method choices made on the real data (for example the Kedah thresholds and land-only scoring) are recorded in the plan's decision log (ADR-030) and in the app's "How sure are we?" panel.
- **AI analysis.** The "AI analysis" notes for the six focus districts (what the radar shows, and what to check next) were written by Claude (Anthropic) on 14 Nov 2026, reading our own pipeline results (`public/data/stats.json`, `public/data/rain.json`). `pipeline/11_ai_analysis.py` stores them in `public/data/focus_areas.json` and fails if any number in the text cannot be found in, or recomputed from, those results files. The app labels them "Written by AI from our results · not yet reviewed" until a person has checked them.
- **Other text.** Plain-language explanations, chart captions and the sourced facts were drafted by Claude from the plan's sources.
- **Numbers.** No number in the app is produced by an AI model. Hectares, percentages, rainfall and agreement scores are computed by the pipeline scripts from NASA data; the AI analysis only quotes them.
- **In the page.** No AI model runs in the web page.
