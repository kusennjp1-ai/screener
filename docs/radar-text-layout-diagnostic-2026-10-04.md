# Bounded Radar text-layout experiment

This artifact-only branch is based on `d7fe640`. Its sole push workflow runs on
`diagnostic/radar-text-layout-20261004`, with `contents: read`. It installs normal
frontend/browser dependencies, builds the existing isolated historical Radar
fixture, runs the diagnostic, and uploads ordinary artifacts. It does not run
Pages, publication, financial preparation, provider collection, or new secrets.
Existing push workflows target other branches. No pull request is required.

The control is the current production CSS context. The candidate adds only
`.setup-radar { font-feature-settings:normal; font-variant-numeric:normal; }`.
The existing `.mono` axis rules, font families, labels, geometry, 207 observations,
canvas code and first-frame boundary remain identical. No production CSS changes.
The candidate's expected production-context failure remains in each record;
neither arm is declared production acceptance by this experiment.

There are exactly 24 uninstrumented cold first mounts: 1440/390px × dark/light ×
three pairs, ordered control/candidate, candidate/control, control/candidate.
Each sample starts a fresh browser. Eight additional fresh-browser trace/profile
samples, one per arm and viewport/theme, are explicitly separate measurements.
There are no discarded warmups, retries, glyph/font preloads or React prerenders.
Every sample and its original 50ms reference result is retained, including errors.
Trace-stop acknowledgement and completion share a 10-second deadline. A timeout
or rejection records both states, writes collected events as a partial trace and
persists the sample before browser cleanup; it does not wait again for a profile.

The DOM retention option acts only after the unchanged endpoint and its original
same-task pixel/CSS/transform/hit-test evidence. It permits inspection of the same
rendered content, not another timed mount. CDP captures an immediate post-endpoint
PNG without Playwright's implicit font-ready screenshot wait. Its before/after
clocks and font state make clear that it is later than the exact endpoint witness.
For traced samples, an endpoint frame image is emitted only if the trace screenshot
timestamp lies after initial Paint and no later than the endpoint callback. A
missing eligible frame is reported; a later image is never substituted.

A second image follows actual font settlement. The report retains FontFace
statuses, font/network failures, response-body hashes, and actual platform-font
glyph evidence for rendered text and axes. Missing, failed or substituted fonts
invalidate a speed signal. The browser allowlist permits only the local fixture
server and its existing Google Fonts services. Source/tree IDs, relevant source
hashes, compiled assets/maps and hashes accompany every sample and trace.

The predeclared signal requires all three paired render/layout improvements to
be at least 5ms, with complete font evidence, identical labels/axis styles and no
unexpected geometry/visibility/context defects. The 5ms signal rule is not a
replacement performance budget. A signal still requires review of actual dark/
light, desktop/mobile pictures and traces before any production proposal. An
inconsistent result rejects or leaves this path inconclusive; it does not trigger
reruns until a favorable outcome appears. No result grants production adoption.

Unit tests cover the fixed trial count/order, narrow CSS scope, preserved 50ms
failures, expected context differences, missing-font rejection, trace interval
accounting and workflow permissions/triggers. Local validation does not establish
browser execution, screenshots, performance, or acceptance. The parent coordinates
the one branch push and reviews resulting artifacts before further action.

## Execution repair after the first artifact

Run `37242914677`, commit `436f4c4bc19cbc96885adf1ecd2bf8cd689bd79b`, produced
32 retained failed samples. Its original ZIP SHA-256 is
`bcc13f8110e2020bb5847b222e242e5193e111539090984c1573c67048f0b409`.
No original artifact is rewritten or discarded. All controls failed because
Playwright rejects empty style content. All candidates measured, then resource
bookkeeping threw when completion events lacked request URLs. The twelve
uninstrumented candidate endpoints were 92.7–110.2ms, all above 50ms. Without
measured controls, this failed protocol establishes no paired improvement.

Protocol `radar-inherited-text-features-ab-v2` repairs only those execution defects.
The control inserts an explicit CSS comment with no rules. Completion metadata
is correlated with request or response events by request ID, keeping raw records
and reporting recovered, invalid and unresolved URLs. Font failures remain
failures; unresolved records that could be fonts invalidate font completeness.
The two uncorrelated completions in each original candidate have matching local
HTML/CSS response records. The original 24+8 design, timing boundary, cold state,
font loading, candidate CSS and 50ms budget are unchanged. Any corrected execution
is a separately identified protocol repair, never a discarded unfavorable trial.
