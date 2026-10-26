# Mobile research UI audit and improvement loop

Primary user: a Japanese-speaking individual screening US stocks on a phone, using one hand.
Primary task: understand the market, find a candidate, inspect its detailed price/volume/RS chart and VCP intervals, then inspect the evidence behind a condition and save a watch.

Target: https://kusennjp1-ai.github.io/screener/ and frontend/src/static/components plus ResearchPage and StaticMarketContext. Baseline: 9762ea84fa2d49482043ea3e4940b4ccb43a3407.

Requested direction: keep chart detail; simplify surrounding UI. Annotations, explanatory prose and calculation formulas start closed and open when the relevant item is activated. Preserve concise pass/fail/unknown states and essential data dates; do not alter screening calculations or disguise unavailable evidence.

Constraints: React static GitHub Pages app; 320/390px phone widths, 568/844px heights, 1440px desktop; 44px touch targets; keyboard and screen-reader disclosure semantics; dark/light themes. Preserve the approved chart/market/VCP direction and existing palette. No new competitor research is required.

Method: evidence collection using the design-is skill's ten Rams principles, then user-authorized implementation, task-based browser audits, fixes, and repeated verification. The user explicitly requests implementation, so the audit skill's handoff-only limitation does not end this task. This is an agent walkthrough and automated measurement, not a human usability study or a physical iOS/Android test. Use available Playwright tools because the catalog does not provide agent-browser.

Audit loops: (1) baseline information density/discoverability, (2) apply progressive disclosure and audit core phone flows, (3) check alternate sizes/themes, keyboard/focus, state reset and missing data, then repair findings and verify the public release.
