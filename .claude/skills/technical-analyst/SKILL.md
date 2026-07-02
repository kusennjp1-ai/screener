---
name: technical-analyst
description: This skill should be used when analyzing weekly price charts for stocks, stock indices, cryptocurrencies, or forex pairs. Use this skill when the user provides chart images and requests technical analysis, trend identification, support/resistance levels, scenario planning, or probability assessments based purely on chart data without consideration of news or fundamental factors.
---

# technical-analyst (loader)

This is a thin loader for the vendored skill library. Do NOT improvise:

1. Read `trading-skills/skills/technical-analyst/SKILL.md` and follow it exactly.
2. Resolve that skill's `references/`, `scripts/`, and `assets/` paths relative
   to `trading-skills/skills/technical-analyst/`.
3. If the skill needs API keys (FMP/FINVIZ etc.), check its own instructions
   for the env var names before asking the user.
