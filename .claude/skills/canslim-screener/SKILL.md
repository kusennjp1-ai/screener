---
name: canslim-screener
description: Screen US stocks using William O'Neil's CANSLIM growth stock methodology. Use when user requests CANSLIM stock screening, growth stock analysis, momentum stock identification, or wants to find stocks with strong earnings and price momentum following O'Neil's investment system.
---

# canslim-screener (loader)

This is a thin loader for the vendored skill library. Do NOT improvise:

1. Read `trading-skills/skills/canslim-screener/SKILL.md` and follow it exactly.
2. Resolve that skill's `references/`, `scripts/`, and `assets/` paths relative
   to `trading-skills/skills/canslim-screener/`.
3. If the skill needs API keys (FMP/FINVIZ etc.), check its own instructions
   for the env var names before asking the user.
