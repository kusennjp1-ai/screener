# Radar readiness at the first-frame boundary

CI run 37190128474 (capture 84beaab9733a42aa0a8280b8be8116700c781679)
recorded cold D9 times of 64.6 ms at 1440 px and 63.2 ms at 390 px.
All 207 circles were drawn and aligned to CSS size and DPR. However, the
production-context witness also recorded `radar-plot` opacity `0` in both
cold runs: the production `research-rise` entrance animation lasts 220 ms.
Those historical times establish drawn/aligned readiness, not visible readiness.

The application now removes only the radar entrance animation. Its marks,
labels, accessibility, interaction, source data and canvas renderer are unchanged.
This is a visibility correction, not evidence of a 50 ms performance pass.

The existing endpoint remains the next animation frame after synchronous mount.
Immediately after recording that duration, in the same JavaScript task without
yielding, the harness reads the actual canvas bitmap and ancestor CSS visibility.
It checks all 207 canonical point centers for circle-strength pixel alpha, full
ancestor opacity and unobscured on-screen positions. Blank or grid-only pixels,
hidden ancestors, failed readback and missing evidence fail closed. Reference
geometry is derived after pixel readback, so it cannot warm the cold mount.
The witness is bitmap/CSS evidence, not a claim about compositor presentation.

Readback and complete observation cost are reported separately as
`visibility.pixel_readback_ms` and `visibility.observation_ms`; neither is
subtracted from `first_frame_ms`. Because the capture never yields, later-frame
drawing cannot repair the recorded endpoint evidence. Both main acceptance and
the additional DPR2 diagnostic use the same visibility checks.

The 50 ms limit, all three runs including the cold first mount, exactly 207
actual points and final CSS/DPR alignment remain mandatory. Current-context v2
and prior benchmark results remain failures unless new browser evidence passes.
