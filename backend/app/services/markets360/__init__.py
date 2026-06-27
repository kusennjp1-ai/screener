"""Markets 360 — standalone Minervini Markets 360-style analytics module.

This package is intentionally decoupled from the existing multi-screener
pipeline. It assembles a self-contained payload (quote, proprietary-style
ratings, band states, chart overlays, buy signal, quarterly growth table) for
the Markets 360 chart view, reusing only pure, shared calculators
(``minervini_bands``, RS line, VCP detection) for data it does not own.
"""
