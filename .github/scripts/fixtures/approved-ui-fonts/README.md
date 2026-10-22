# Approved predecessor font stylesheet fixtures

These files retain the exact CSS bytes pinned by the retained-price publisher
browser proof. They are test inputs only, never imported by the application.

Approved predecessor: `1e1943e1d5f78a738a05baa69eb9f2e8508e32ac`
(as identified by `PUBLISHER_TOOLING.base.sha`).

| Fixture | Original repository path | Pinned Git blob |
| --- | --- | --- |
| foundation.css | frontend/src/static/theme/foundation.css | d2790d3b3b1764c34a936b26d719fdbce4e35e5f |
| index.css | frontend/src/index.css | 3909758330379e3061badf17624a1698288e616a |

The test recomputes each full Git blob hash and checks the exact first-line
font import against the production blocked-attempt constants. Keep these bytes
and pins unchanged when the current candidate UI's styling evolves. This does
not allow any external network request: the production gate still aborts every
external request and fails unexpected attempts or successful external access.
