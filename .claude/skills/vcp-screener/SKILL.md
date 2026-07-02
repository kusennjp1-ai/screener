---
name: vcp-screener
description: Screen S&P 500 stocks for Mark Minervini's Volatility Contraction Pattern (VCP). Identifies Stage 2 uptrend stocks forming tight bases with contracting volatility near breakout pivot points. Use when user requests VCP screening, Minervini-style setups, tight base patterns, volatility contraction breakout candidates, or Stage 2 momentum stock scanning.
---

# vcp-screener (loader)

This is a thin loader for the vendored skill library. Do NOT improvise:

1. Read `trading-skills/skills/vcp-screener/SKILL.md` and follow it exactly.
2. Resolve that skill's `references/`, `scripts/`, and `assets/` paths relative
   to `trading-skills/skills/vcp-screener/`.
3. If the skill needs API keys (FMP/FINVIZ etc.), check its own instructions
   for the env var names before asking the user.
