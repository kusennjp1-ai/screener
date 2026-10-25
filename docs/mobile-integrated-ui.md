# Mobile research flow

The primary mobile workflow is market → stock chart → VCP evidence → watchlist.
The user selected the chart-first, VCP lab and market-map directions. An integrated
interactive mockup and chart image were shown before implementation.

- At 700px and below, home opens an industry map. Each tile displays the number
  of stocks passing the selected method out of the published industry universe.
  Color separates RS medians at 80, below 80, and unavailable. This is neither
  a market return heatmap nor a market-cap weighted map. No unavailable rating
  is filled with zero. The first six industries appear initially; all remain
  reachable through the expand control. Candidates link to the real chart.
- Market context links to the existing breadth observations. Bottom navigation
  returns to market, chart or watchlist, including from other routes.
- Charts use the current main SVG renderer and verified price payload. The VCP
  lab consumes the same bookTechnicalEvidence intervals as the plotted guides.
  A measured interval is not a passing VCP: sequential depth contraction and
  interval-average volume contraction remain distinct observations. Period and zoom
  controls are grouped in a disclosure on mobile. VCP intervals stay accessible;
  measured detail expands below the plot. A selected interval focuses the exact
  plotted dates. Unknown data, weekly mode and identity errors remain explicit.
- Previous, save and next are fixed above bottom navigation, with disabled
  boundaries and at least 44px targets. Watch persistence uses the existing store
  and its existing failure notice. Safe-area padding protects the bottom controls.
- Desktop workspace and comparison remain available. Mobile list/filter access
  remains under the market map. Existing financial, qualification and source
  evidence remain available after the chart.

Prototype values are synthetic and are never imported by the application.
Production snapshots remain read-only. This change does not deploy GitHub Pages.

## Verification

Dedicated browser tests cover the complete flow at 320px and 390px, exact VCP
interval selection, save/watch filtering, next-symbol identity, touch targets,
horizontal overflow and navigation accessibility. VCP inline/modal regression
also runs at mobile and desktop sizes. Industry component tests cover unknown and
zero ratings, qualification counts, rounding and sector-filtered navigation.
The mobile list regression enters through the new map and checks existing filter,
keyboard focus and injected safe-area behavior against the 56px header plus 8px
focus clearance. Injected insets are not a substitute for native iOS testing.

## Main integration

Integrated main at cade2bf. The plot measures its actual mobile width so axis
labels retain their intended font size. Selecting a VCP interval focuses the
measured start/end dates with context and highlights the corresponding guide.
Publication or symbol identity changes reset the selected interval and viewport.
Weekly mode withholds the daily VCP lab. Financial and qualification details
follow the chart on mobile, keeping the first view focused on price action.
