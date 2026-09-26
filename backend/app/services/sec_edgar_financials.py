"""Code 33 — Minervini earnings-acceleration test from SEC EDGAR XBRL facts.

Code 33 (Mark Minervini, *Trade Like a Stock Market Wizard*): diluted EPS,
sales YoY growth, AND net profit margin LEVELS each rise over three consecutive
quarter-to-quarter comparisons: FOUR quarterly observations (Fig. 8.10).
EPS/sales comparisons are YoY, not QoQ; margin is quarterly net income/revenue,
not YoY margin growth. Negative initial EPS/sales growth is allowed.

Data source: SEC EDGAR XBRL "company facts"
(``data.sec.gov/api/xbrl/companyfacts/CIK##########.json``) — free, no key,
full multi-year quarterly history of actual 10-Q/10-K filings, which is what the
four-point YoY test needs (~8 quarters). US filers only.

This module is split so the *parsing/computation* is pure and unit-testable
against a fixture (no network), while ``SecEdgarClient`` does the fetching (used
from CI, where outbound access to data.sec.gov is available).
"""
from __future__ import annotations

import time
import math
from datetime import date, timedelta
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Diluted EPS lives under USD/shares; revenue/net income under USD. Multiple tags
# exist across filers/eras — try them in order and take the first that yields a
# usable quarterly series.
EPS_TAGS = ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted")
REVENUE_TAGS = (
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
)
NET_INCOME_TAGS = ("NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic")

_QUARTER_MIN_DAYS = 75
_QUARTER_MAX_DAYS = 105
_ANNUAL_MIN_DAYS = 330
_ANNUAL_MAX_DAYS = 400
_FP_TO_NUM = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}


def _days(start: str, end: str) -> Optional[int]:
    try:
        return (date.fromisoformat(end) - date.fromisoformat(start)).days
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class Quarter:
    fy: int
    q: int  # 1..4

    @property
    def key(self) -> tuple[int, int]:
        return (self.fy, self.q)


def _select_unit_entries(fact: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Return the entry list from the first available unit of an XBRL fact."""
    if not fact:
        return []
    units = fact.get("units") or {}
    for unit_key in ("USD/shares", "USD"):
        if unit_key in units:
            return units[unit_key] or []
    # Fall back to whatever single unit exists.
    for entries in units.values():
        return entries or []
    return []


def _first_tag(facts: dict[str, Any], tags: Iterable[str]) -> dict[str, Any] | None:
    gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    for tag in tags:
        if tag in gaap:
            return gaap[tag]
    return None


def quarterly_series(facts: dict[str, Any], tags: Iterable[str], *, is_eps: bool) -> dict[tuple[int, int], float]:
    """Build a {(fy, q): value} quarterly series for the first usable tag.

    Three-month entries are taken directly. The fourth quarter is almost always
    only filed as the full year (10-K), so Q4 is derived as annual minus the
    three reported quarters of the same fiscal year (revenue/net income are
    additive). EPS is NOT additive because annual and quarterly weighted share
    denominators differ; only directly reported quarterly EPS is accepted.
    """
    fact = _first_tag(facts, tags)
    entries = _select_unit_entries(fact)
    if not entries:
        return {}

    quarterly: dict[tuple[int, int], float] = {}
    annual: dict[int, float] = {}

    # Most recent filing wins on duplicate periods (restatements): sort by filed.
    for e in sorted(entries, key=lambda x: x.get("filed", "")):
        val = e.get("val")
        fy = e.get("fy")
        fp = e.get("fp")
        start, end = e.get("start"), e.get("end")
        if val is None or fy is None or not start or not end:
            continue
        dur = _days(start, end)
        if dur is None:
            continue
        if _QUARTER_MIN_DAYS <= dur <= _QUARTER_MAX_DAYS:
            q = _FP_TO_NUM.get(fp)
            if q in (1, 2, 3, 4):
                quarterly[(int(fy), q)] = float(val)
        elif _ANNUAL_MIN_DAYS <= dur <= _ANNUAL_MAX_DAYS:
            annual[int(fy)] = float(val)

    # Derive Q4 = FY - (Q1 + Q2 + Q3) where all three quarters are present.
    for fy, fy_val in ([] if is_eps else annual.items()):
        if (fy, 4) in quarterly:
            continue
        q123 = [quarterly.get((fy, q)) for q in (1, 2, 3)]
        if all(v is not None for v in q123):
            quarterly[(fy, 4)] = float(fy_val) - float(sum(q123))

    return quarterly


def quarterly_series_dated(
    facts: dict[str, Any], tags: Iterable[str], *, is_eps: bool, as_of: Optional[str] = None,
    _period_starts: Optional[dict[str, str]] = None,
) -> list[tuple[str, float, str]]:
    """Quarterly series keyed by PERIOD END DATE: ``[(end, value, label), ...]``
    ascending by end.

    EDGAR's ``fy``/``fp`` describe the FILING's fiscal frame, not the period's:
    a prior-year comparative row inside a newer 10-Q carries the newer fiscal
    year, so keying by ``(fy, q)`` loses/clobbers year-ago quarters (the
    "missing/invalid YoY base" failures observed across large caps in the CI
    Code 33 check). End-date keying is collision-free; duplicates of the SAME
    period dedupe by latest ``filed`` (restatements win), while the display
    label comes from the EARLIEST filing of that period — the original filing
    labels its own quarter correctly.

    Revenue/income Q4 may be derived only from three contiguous quarters exactly
    covering the annual start. EPS is never derived by subtraction.

    ``as_of`` (YYYY-MM-DD) makes the series point-in-time: only entries FILED
    on or before that date are used (entries without a ``filed`` date are
    dropped for zero look-ahead), reproducing exactly what an investor could
    have known then — later restatements included in newer filings vanish.
    """
    fact = _first_tag(facts, tags)
    entries = _select_unit_entries(fact)
    if not entries:
        return []

    # end -> (filed, value) for 3-month periods; end -> (filed, label)
    q_val: dict[str, tuple[str, float]] = {}
    q_label: dict[str, tuple[str, str]] = {}
    starts: dict[str, str] = {}
    annual: dict[str, tuple[str, float, str]] = {}  # end -> (filed, value, start)

    for e in entries:
        val = e.get("val")
        start, end = e.get("start"), e.get("end")
        if not isinstance(val, (int, float)) or isinstance(val, bool) or not math.isfinite(val) or not start or not end:
            continue
        dur = _days(start, end)
        if dur is None:
            continue
        filed = e.get("filed", "")
        if filed and (_days(end, filed) is None or filed < end):
            continue
        if as_of is not None and (not filed or _days(filed, as_of) is None or filed > as_of or end > as_of):
            continue
        if _QUARTER_MIN_DAYS <= dur <= _QUARTER_MAX_DAYS:
            prev = q_val.get(end)
            if prev is None or filed >= prev[0]:
                q_val[end] = (filed, float(val))
                starts[end] = start
            fy, fp = e.get("fy"), e.get("fp")
            q = _FP_TO_NUM.get(fp)
            if fy is not None and q in (1, 2, 3, 4):
                lprev = q_label.get(end)
                if lprev is None or filed < lprev[0]:
                    # Q4 rows often exist ONLY as comparatives in the NEXT
                    # year's 10-K (DECK's 2025-03-31 Q4 carries fy=2026), so
                    # for Q4 the end year is the trustworthy fiscal label.
                    label_fy = int(end[:4]) if q == 4 else int(fy)
                    q_label[end] = (filed, f"FY{label_fy}Q{q}")
        elif _ANNUAL_MIN_DAYS <= dur <= _ANNUAL_MAX_DAYS:
            prev_a = annual.get(end)
            if prev_a is None or filed >= prev_a[0]:
                annual[end] = (filed, float(val), start)

    # Derive Q4 = annual - the three quarters ending inside the annual window.
    for a_end, (a_filed, a_val, a_start) in ([] if is_eps else annual.items()):
        if a_end in q_val:
            continue  # a real 3-month Q4 entry already covers this end
        inside = sorted([
            (end, v) for end, (_, v) in q_val.items()
            if a_start <= starts[end] and end < a_end
        ])
        if (len(inside) == 3 and starts[inside[0][0]] == a_start and
                all(_days(inside[i - 1][0], starts[inside[i][0]]) == 1 for i in (1, 2)) and
                _QUARTER_MIN_DAYS <= (_days(inside[-1][0], a_end) or 0) <= _QUARTER_MAX_DAYS):
            q_val[a_end] = (a_filed, a_val - sum(v for _, v in inside))
            starts[a_end] = (date.fromisoformat(inside[-1][0]) + timedelta(days=1)).isoformat()
            # Label by the period's END year, not the annual entry's fy — that
            # fy is the FILING's frame (GM's 2023-12-31 Q4 arrives inside the
            # FY2025 10-K and would be labeled FY2025Q4, or FY0Q4 when absent).
            q_label[a_end] = ("", f"FY{a_end[:4]}Q4")

    out = [
        (end, v, q_label.get(end, ("", end))[1])
        for end, (_, v) in q_val.items()
    ]
    out.sort(key=lambda t: t[0])
    if _period_starts is not None:
        _period_starts.update(starts)
    return out


def _yoy_base(dated: dict[str, float], end: str, starts: Optional[dict[str, str]] = None) -> Optional[float]:
    """The value of the quarter ending ~1 year before ``end`` (350-380 days,
    widened to 340-390 as a fallback for irregular fiscal calendars)."""
    for lo, hi in ((350, 380), (340, 390)):
        for base_end, val in dated.items():
            d = _days(base_end, end)
            if d is not None and lo <= d <= hi:
                if starts is not None:
                    # Allow one fiscal week (53-week years), never a stub
                    # versus a full quarter merely sharing a nearby end date.
                    current_duration = _days(starts[end], end)
                    prior_duration = _days(starts[base_end], base_end)
                    if current_duration is None or prior_duration is None or abs(current_duration - prior_duration) > 7:
                        continue
                return val
    return None


def dated_quarterly_eps(facts: dict[str, Any], tags: Iterable[str] = EPS_TAGS) -> list[tuple[str, float]]:
    """``[(end_date, diluted_eps), ...]`` for quarterly EPS, oldest-first.

    Uses the *end date* of each 3-month (quarterly) diluted-EPS entry so the
    series can be plotted on a time axis (for a MarketSurge-style EPS line).
    Most-recent filing wins on duplicate periods (restatements). Annual 10-K
    EPS (12-month) is excluded — only dated quarterly points are returned.
    """
    fact = _first_tag(facts, tags)
    entries = _select_unit_entries(fact)
    by_date: dict[str, float] = {}
    for e in sorted(entries, key=lambda x: x.get("filed", "")):
        val = e.get("val")
        start, end = e.get("start"), e.get("end")
        if val is None or not start or not end:
            continue
        dur = _days(start, end)
        if dur is not None and _QUARTER_MIN_DAYS <= dur <= _QUARTER_MAX_DAYS:
            by_date[end] = float(val)
    return sorted(by_date.items())


def _ordered_quarters(keys: Iterable[tuple[int, int]]) -> list[Quarter]:
    return [Quarter(fy, q) for (fy, q) in sorted(keys, reverse=True)]


def _yoy_growth(value: Optional[float], prior: Optional[float]) -> Optional[float]:
    # Clean YoY only on a positive prior-year base (negative/zero bases make the
    # growth rate meaningless for an "acceleration" comparison).
    if value is None or prior is None or prior <= 0:
        return None
    return (value - prior) / prior


@dataclass
class Code33Result:
    passes: bool
    reason: str = ""
    eps_yoy: list[float] = field(default_factory=list)
    sales_yoy: list[float] = field(default_factory=list)
    margin_yoy: list[Optional[float]] = field(default_factory=list)  # Legacy informational field, not gated.
    quarters: list[str] = field(default_factory=list)
    margin_levels: list[Optional[float]] = field(default_factory=list)  # Fractions, latest first.
    mode: str = "code33-four-quarter-margin-levels"


def compute_code33_from_facts(
    facts: dict[str, Any], *, require_margin: bool = True, as_of: Optional[str] = None
) -> Code33Result:
    """Evaluate Code 33 from a parsed EDGAR companyfacts dict.

    Four consecutive quarters provide three increases in EPS/sales YoY and net
    margin levels. ``require_margin=False`` is a separately labelled relaxed
    EPS/sales diagnostic, not full Code 33, and must not populate its flag.

    ``as_of`` evaluates point-in-time (filings filed on or before that date) —
    used to measure the historical catch rate at trade-idea dates.
    """
    eps_starts, rev_starts, ni_starts = {}, {}, {}
    eps_d = quarterly_series_dated(facts, EPS_TAGS, is_eps=True, as_of=as_of, _period_starts=eps_starts)
    rev_d = quarterly_series_dated(facts, REVENUE_TAGS, is_eps=False, as_of=as_of, _period_starts=rev_starts)
    ni_d = quarterly_series_dated(facts, NET_INCOME_TAGS, is_eps=False, as_of=as_of, _period_starts=ni_starts)
    if not eps_d or not rev_d or (require_margin and not ni_d):
        return Code33Result(False, "missing EPS/revenue/net-income series")

    eps = {end: v for end, v, _ in eps_d}
    rev = {end: v for end, v, _ in rev_d}
    ni = {end: v for end, v, _ in ni_d}
    label_by_end = {end: label for end, _, label in eps_d}

    # Margin per quarter-end where both revenue and net income exist (rev > 0).
    margin: dict[str, float] = {}
    for end, r in rev.items():
        n = ni.get(end)
        if n is not None and r and r > 0:
            margin[end] = n / r

    # Use the latest observed dates, not an intersection that could hide a
    # missing latest metric and silently certify an older four-quarter run.
    recent = sorted(set(eps) | set(rev) | (set(ni) if require_margin else set()), reverse=True)[:4]
    if len(recent) < 4:
        return Code33Result(False, "fewer than 4 comparable quarters")
    if any(not (_QUARTER_MIN_DAYS <= (_days(recent[i + 1], recent[i]) or 0) <= _QUARTER_MAX_DAYS) for i in range(3)):
        return Code33Result(False, "nonconsecutive quarterly periods")

    eps_yoy: list[float] = []
    sales_yoy: list[float] = []
    margin_yoy: list[Optional[float]] = []
    margin_levels: list[Optional[float]] = []
    labels: list[str] = []
    for end in recent:
        if end not in eps or end not in rev or (require_margin and end not in margin):
            return Code33Result(False, f"missing current quarterly metric at {end}")
        if eps_starts[end] != rev_starts[end] or (require_margin and ni_starts[end] != rev_starts[end]):
            return Code33Result(False, f"quarter duration mismatch at {end}")
        # Year-ago base by END DATE, not fiscal label — EDGAR fy/fp describe
        # the filing's frame and lose year-ago quarters to relabeled
        # comparatives (see quarterly_series_dated).
        eps_base, rev_base = _yoy_base(eps, end, eps_starts), _yoy_base(rev, end, rev_starts)
        mar_base = _yoy_base(margin, end)
        g_eps = _yoy_growth(eps.get(end), eps_base)
        g_rev = _yoy_growth(rev.get(end), rev_base)
        g_mar = _yoy_growth(margin.get(end), mar_base)
        # Margin YoY is informational only; net margin LEVEL is gated.
        if g_eps is None or g_rev is None:
            label = label_by_end.get(end, end)
            # A quarter that EXISTS but has a non-positive base is a
            # legitimate Code 33 fail — % growth off a loss quarter is
            # undefined, and Minervini's test targets profitable growers.
            # Only a genuinely absent quarter means "cannot judge".
            gated_bases = [eps_base, rev_base]
            if any(b is not None and b <= 0 for b in gated_bases):
                return Code33Result(False, f"YoY base <= 0 at {label} — loss quarter, % growth undefined")
            return Code33Result(False, f"missing YoY base at {label}")
        eps_yoy.append(g_eps)
        sales_yoy.append(g_rev)
        margin_yoy.append(g_mar)
        margin_levels.append(margin.get(end))
        labels.append(label_by_end.get(end, end))

    # Latest first: four values are needed for THREE strict increases.
    def _accelerating(series: list[float]) -> bool:
        return len(series) == 4 and all(series[i] > series[i + 1] for i in range(3))

    legs = [_accelerating(eps_yoy), _accelerating(sales_yoy)]
    if require_margin:
        legs.append(_accelerating(margin_levels))
    passes = all(legs)
    metric_label = "EPS/sales YoY and net margin levels" if require_margin else "relaxed EPS/sales YoY (not full Code 33)"
    return Code33Result(
        passes=passes,
        reason=("ok" if require_margin else "relaxed EPS/sales only; not full Code 33") if passes else f"not accelerating in {metric_label}",
        eps_yoy=eps_yoy,
        sales_yoy=sales_yoy,
        margin_yoy=margin_yoy,
        quarters=labels,
        margin_levels=margin_levels,
        mode="code33-four-quarter-margin-levels" if require_margin else "relaxed-eps-sales-only",
    )


class SecEdgarClient:
    """Minimal SEC EDGAR XBRL client (network — used from CI, not unit tests).

    SEC requires a descriptive User-Agent and asks for <=10 req/sec; the repo's
    rate budget already reserves ``sec_edgar`` at that rate.
    """

    TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
    FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

    def __init__(self, user_agent: str = "screener-research code33 (contact: research@example.com)", min_interval: float = 0.12):
        self._ua = user_agent
        self._min_interval = min_interval
        self._last = 0.0
        self._cik_map: dict[str, int] | None = None

    def _throttle(self) -> None:
        wait = self._min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _get_json(self, url: str) -> Any:
        import requests

        self._throttle()
        resp = requests.get(url, headers={"User-Agent": self._ua, "Accept-Encoding": "gzip, deflate"}, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def cik_for(self, ticker: str) -> Optional[int]:
        if self._cik_map is None:
            data = self._get_json(self.TICKERS_URL)
            self._cik_map = {
                str(row["ticker"]).upper(): int(row["cik_str"])
                for row in data.values()
            }
        return self._cik_map.get(ticker.upper())

    def company_facts(self, ticker: str) -> Optional[dict[str, Any]]:
        cik = self.cik_for(ticker)
        if cik is None:
            return None
        try:
            return self._get_json(self.FACTS_URL.format(cik=cik))
        except Exception:  # noqa: BLE001 - missing/withdrawn filers are not fatal
            return None

    def code33(self, ticker: str, *, require_margin: bool = True, as_of: Optional[str] = None) -> Code33Result:
        facts = self.company_facts(ticker)
        if not facts:
            return Code33Result(False, "no EDGAR facts")
        return compute_code33_from_facts(facts, require_margin=require_margin, as_of=as_of)

    def code33_map(self, tickers: list[str], *, require_margin: bool = True) -> dict[str, bool]:
        """{ticker: passes} for many tickers. Missing/withdrawn filers -> False.

        Pre-warms the CIK map once, then fetches each company's facts. Used to
        stamp ``code33`` onto US scan rows during the static build (EDGAR is
        US-only). Fetch failures yield False; relaxed mode is rejected because
        an EPS/sales-only result must never populate the Code 33 flag.
        """
        if not require_margin:
            raise ValueError("code33_map requires all three Code 33 legs")
        out: dict[str, bool] = {}
        for ticker in tickers:
            try:
                out[ticker.upper()] = self.code33(ticker, require_margin=require_margin).passes
            except Exception:  # noqa: BLE001 - one bad symbol must not abort the batch
                out[ticker.upper()] = False
        return out
