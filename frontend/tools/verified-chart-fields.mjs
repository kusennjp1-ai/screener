// Fields of the raw verified chart copy (static-data/verified-charts) that no
// published screen or gate reads. Pages stores that copy uncompressed; the
// brief reads bars, rs_line, the session calendar, identity and stock_data.
// The packed market chart keeps every field.
export const VERIFIED_CHART_OMITTED = Object.freeze(['fundamentals', 'bands', 'buy_points', 'vcp_boxes', 'blue_dots', 'eps_line', 'rs_rating_history']);
