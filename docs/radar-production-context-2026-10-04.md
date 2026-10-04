# Radar production context and first-frame visibility

The prior isolated D9 harness mounted an unclassed div directly under body. It
imported foundation and workbench CSS, but did not activate the `.leader-shell`
font and box-sizing rules, `research.css` numeric inheritance, or ResearchHero's
overview/mobile styles. It also omitted `motion.css` and the `.research-hero`
ancestor, hiding the production radar's 220ms opacity/translation entrance.

This changes the measurement context, not the performance threshold. Old results
must retain their old context and cannot be compared as like-for-like speed
measurements against `production-hero-fixed-slot-visible-v3`. No performance
improvement or 50ms pass is established by the source change or unit tests.

## Evidence for the corrected scope

- `src/static/StaticLayout.jsx` renders `.leader-shell[data-theme]` then
  `.leader-content`, importing research, foundation, motion and workbench CSS.
- `src/static/pages/ResearchPage.jsx` renders `main.research-workbench` around
  ResearchHero; `research.css` supplies inherited `tabular-nums`.
- `src/static/components/ResearchHero.jsx` renders
  `section.research-hero.research-overview`, then `.hero-copy` and SetupRadar.
  Its actual small-screen condition is `(max-width:700px)`.
- `src/static/components/researchOverview.css` changes the mobile radar's
  vertical padding to 8px and header height to 20px.
- `src/index.css` supplies the reset. `App.jsx` places an outer CssBaseline
  above StaticLayout: body1 is 14px, weight 400 and line-height 1.5. Installed
  MUI `createTypography` adds default letter-spacing only for its default Roboto
  family, not App's custom Inter family. The harness reproduces these remaining
  inherited CSS values without mounting another React tree.

The harness uses those class ancestors and unchanged CSS. An empty `.hero-copy`
preserves the first grid slot without glyphs. An explicitly named
`.radar-benchmark-slot` is the sole extra wrapper and retains the original
component widths: 628px desktop, 358px mobile, or a reported diagnostic override.
It is an isolated component measurement, not a claim that the whole hero/page
was mounted during D9. P1 measures the application and surrounding UI.

Only the production `.research-hero .radar-plot` entrance-animation selector is
removed. The hero-copy and gauge animations remain. There is no harness-only
animation suppression, reduced-motion override, or visibility/timing shortcut.

## Boundary and gates

The existing `document.fonts.ready` wait, empty container/root creation, initial
animation-frame boundary, synchronous first React mount, forced layout and next
animation-frame endpoint remain. No explicit font/glyph preload, React prerender,
geometry warmup, first-run discard, or work moved out of the measured render is
introduced. The font loading status and computed CSS family are recorded; the
harness does not claim that a computed family proves a downloaded font was used.

Immediately after storing `first_frame_ms`, without yielding, the harness freezes
the real canvas bitmap and ancestor computed CSS. It then derives reference
geometry and checks all 207 centers for circle-strength pixel alpha, full ancestor
opacity, settled transforms, in-viewport and unobscured hit positions. Blank or
grid-only pixels, missing evidence and readback failures fail closed. This is
bitmap/CSS readiness evidence, not compositor-presentation timing. Its readback
and observation costs are reported separately and never subtracted from time.

All three original runs including the cold first React/JIT mount, the unchanged
50ms budget, initial/final 207 drawn points and final CSS/DPR alignment remain
mandatory. The additional DPR2 diagnostic retains its observed time but is not a
replacement acceptance sample. Main acceptance and focused diagnostics share
the context/visibility checks. All original artifacts remain untouched.

The existing pipeline has only a current isolated D9 build. Any requested Radar
baseline/candidate performance comparison must rebuild both source trees with
this identical harness revision and retain all runs. Full-application P1 already
measures both builds. Comparing old bare-div times to new production-context
times would conflate harness and product changes.

## Validation

Focused unit tests verify source ancestry, exact imports, cold boundary placement,
unchanged counts/timing, hidden/blank/obscured/moving/late evidence rejection, and
the production-only removal of Radar entrance motion. They do not establish real
browser visibility or performance. The next combined CI run must capture actual
computed styles, pixels, alignment, all cold/warm timings and the existing P1 /
financial evidence gates before this change can be called accepted.
