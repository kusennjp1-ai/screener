---
name: market-breadth-analyzer
description: Quantifies market breadth health using TraderMonty's public CSV data. Generates a 0-100 composite score across 6 components (100 = healthy). No API key required. Use when user asks about market breadth, participation rate, advance-decline health, whether the rally is broad-based, or general market health assessment.
---

# market-breadth-analyzer (loader)

This is a thin loader for the vendored skill library. Do NOT improvise:

1. Read `trading-skills/skills/market-breadth-analyzer/SKILL.md` and follow it exactly.
2. Resolve that skill's `references/`, `scripts/`, and `assets/` paths relative
   to `trading-skills/skills/market-breadth-analyzer/`.
3. If the skill needs API keys (FMP/FINVIZ etc.), check its own instructions
   for the env var names before asking the user.
