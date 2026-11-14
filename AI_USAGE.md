# How AI was used

- **Code.** The web app and the Python pipeline were written with Claude Code (Anthropic), working from the team's written plan and reviewed by the team. Method choices made on the real data (for example the Kedah thresholds and land-only scoring) are recorded in the plan's decision log (ADR-030) and in the app's "How sure are we?" panel.
- **Text.** Plain-language explanations and the focus-area summaries were drafted by Claude from sourced facts in the plan. The focus-area summaries are marked "AI-drafted · not reviewed" in the app until a person has checked them.
- **Numbers.** No number in the app comes from an AI model. Hectares, percentages and agreement scores are computed by the pipeline scripts from NASA radar data and written to `public/data/stats.json`.
- **In the page.** No AI model runs in the web page.
