---
name: trading-skills-navigator
description: >-
  Recommend the right trading workflow, skillset, API profile, and setup path
  from a natural-language goal. Use this as the on-ramp when a user expresses a
  trading or investing goal and needs to know which skill/workflow to use, where
  to start, or whether something works without paid API keys — e.g. "where do I
  start", "which skill should I use", "I want to swing trade only when the market
  is favorable", "what works without API keys", "どれを使えばいい", "API キー無しで
  使えるものは". Routes and explains only; it never executes trades or auto-runs
  other skills, and it is honest when no workflow has shipped yet.
---

# trading-skills-navigator (loader)

This is a thin loader for the vendored skill library. Do NOT improvise:

1. Read `trading-skills/skills/trading-skills-navigator/SKILL.md` and follow it exactly.
2. Resolve that skill's `references/`, `scripts/`, and `assets/` paths relative
   to `trading-skills/skills/trading-skills-navigator/`.
3. If the skill needs API keys (FMP/FINVIZ etc.), check its own instructions
   for the env var names before asking the user.
