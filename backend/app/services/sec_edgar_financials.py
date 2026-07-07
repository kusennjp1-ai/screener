"""Code 33 — Minervini earnings-acceleration test from SEC EDGAR XBRL facts.

Code 33 (Mark Minervini, *Trade Like a Stock Market Wizard*): diluted EPS,
sales, AND net profit margin each show **rising year-over-year growth for three
consecutive quarters** — i.e. each metric's YoY growth rate is higher than the
prior quarter's YoY growth rate, three quarters running. Comparisons are YoY
(same fiscal quarter, prior year), not QoQ. Quarterly net margin = quarterly net
income / quarterly revenue.

Data source: SEC EDGAR XBRL "company facts"
(``data.sec.gov/api/xbrl/companyfacts/CIK##########.json``) — free, no key,
full multi-year quarterly history of actual 10-Q/10-K filings, which is what the
3-consecutive-YoY-quarters test needs (~7 quarters). US filers only.

This module is split so the *parsing/computation* is pure and unit-testable
against a fixture (no network), while ``SecEdgarClient`` does the fetching (used
from CI, where outbound access to data.sec.gov is available).
"""
from __future__ import annotations

import time
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

_QUARTER_MIN_DAYS = 60
_QUARTER_MAX_DAYS = 100
_ANNUAL_MIN_DAYS = 330
_ANNUAL_MAX_DAYS = 400
_FP_TO_NUM = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}


def _days(start: str, end: str) -> Optional[int]:
    try:
        s = time.strptime(start, "%Y-%m-%d")
        e = time.strptime(end, "%Y-%m-%d")
        return int((time.mktime(e) - time.mktime(s)) / 86400)
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
    additive; diluted EPS is treated as additive, which is the standard
    approximation).
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
            # 10-K filings tag a 3-month period as fp=FY for Q4 in some cases;
            # only accept explicit Q1-Q3 here, derive Q4 from the annual below.
            if q in (1, 2, 3):
                quarterly[(int(fy), q)] = float(val)
        elif _ANNUAL_MIN_DAYS <= dur <= _ANNUAL_MAX_DAYS:
            annual[int(fy)] = float(val)

    # Derive Q4 = FY - (Q1 + Q2 + Q3) where all three quarters are present.
    for fy, fy_val in annual.items():
        q123 = [quarterly.get((fy, q)) for q in (1, 2, 3)]
        if all(v is not None for v in q123):
            quarterly[(fy, 4)] = float(fy_val) - float(sum(q123))

    return quarterly


def quarterly_series_dated(
    facts: dict[str, Any], tags: Iterable[str], *, is_eps: bool
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

    Q4 is derived per annual entry as annual minus the three quarterly values
    whose end dates fall inside that fiscal year's window.
    """
    fact = _first_tag(facts, tags)
    entries = _select_unit_entries(fact)
    if not entries:
        return []

    # end -> (filed, value) for 3-month periods; end -> (filed, label)
    q_val: dict[str, tuple[str, float]] = {}
    q_label: dict[str, tuple[str, str]] = {}
    annual: dict[str, tuple[str, float, int]] = {}  # end -> (filed, value, fy)

    for e in entries:
        val = e.get("val")
        start, end = e.get("start"), e.get("end")
        if val is None or not start or not end:
            continue
        dur = _days(start, end)
        if dur is None:
            continue
        filed = e.get("filed", "")
        if _QUARTER_MIN_DAYS <= dur <= _QUARTER_MAX_DAYS:
            prev = q_val.get(end)
            if prev is None or filed >= prev[0]:
                q_val[end] = (filed, float(val))
            fy, fp = e.get("fy"), e.get("fp")
            q = _FP_TO_NUM.get(fp)
            if fy is not None and q in (1, 2, 3, 4):
                lprev = q_label.get(end)
                if lprev is None or filed < lprev[0]:
                    q_label[end] = (filed, f"FY{int(fy)}Q{q}")
        elif _ANNUAL_MIN_DAYS <= dur <= _ANNUAL_MAX_DAYS:
            prev_a = annual.get(end)
            if prev_a is None or filed >= prev_a[0]:
                fy = e.get("fy")
                annual[end] = (filed, float(val), int(fy) if fy is not None else 0)

    # Derive Q4 = annual - the three quarters ending inside the annual window.
    for a_end, (_, a_val, a_fy) in annual.items():
        if a_end in q_val:
            continue  # a real 3-month Q4 entry already covers this end
        inside = [
            (end, v) for end, (_, v) in q_val.items()
            if end < a_end and (_days(end, a_end) or 9999) < 300
        ]
        if len(inside) == 3:
            q_val[a_end] = ("", a_val - sum(v for _, v in inside))
            q_label.setdefault(a_end, ("", f"FY{a_fy}Q4"))

    out = [
        (end, v, q_label.get(end, ("", end))[1])
        for end, (_, v) in q_val.items()
    ]
    out.sort(key=lambda t: t[0])
    return out


def _yoy_base(dated: dict[str, float], end: str) -> Optional[float]:
    """The value of the quarter ending ~1 year before ``end`` (350-380 days,
    widened to 340-390 as a fallback for irregular fiscal calendars)."""
    for lo, hi in ((350, 380), (340, 390)):
        for base_end, val in dated.items():
            d = _days(base_end, end)
            if d is not None and lo <= d <= hi:
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
    margin_yoy: list[float] = field(default_factory=list)
    quarters: list[str] = field(default_factory=list)


def compute_code33_from_facts(facts: dict[str, Any], *, require_margin: bool = True) -> Code33Result:
    """Evaluate Code 33 from a parsed EDGAR companyfacts dict.

    Literal Code 33 (``require_margin=True``) needs diluted EPS, sales, AND net
    margin all accelerating in YoY growth for three consecutive quarters — in
    practice almost no company satisfies the margin leg three quarters running.
    ``require_margin=False`` is the relaxed screen used live: EPS and sales YoY
    growth accelerating for three quarters (margin is still computed and
    reported, just not gated on).
    """
    eps_d = quarterly_series_dated(facts, EPS_TAGS, is_eps=True)
    rev_d = quarterly_series_dated(facts, REVENUE_TAGS, is_eps=False)
    ni_d = quarterly_series_dated(facts, NET_INCOME_TAGS, is_eps=False)
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

    # The three most recent quarter-ends carrying the metrics we gate on.
    comparable = set(eps) & set(rev)
    if require_margin:
        comparable &= set(margin)
    recent = sorted(comparable, reverse=True)
    if len(recent) < 3:
        return Code33Result(False, "fewer than 3 comparable quarters")

    eps_yoy: list[float] = []
    sales_yoy: list[float] = []
    margin_yoy: list[float] = []
    labels: list[str] = []
    for end in recent[:3]:
        # Year-ago base by END DATE, not fiscal label — EDGAR fy/fp describe
        # the filing's frame and lose year-ago quarters to relabeled
        # comparatives (see quarterly_series_dated).
        g_eps = _yoy_growth(eps.get(end), _yoy_base(eps, end))
        g_rev = _yoy_growth(rev.get(end), _yoy_base(rev, end))
        g_mar = _yoy_growth(margin.get(end), _yoy_base(margin, end))
        # Margin YoY is informational unless gated on.
        if g_eps is None or g_rev is None or (require_margin and g_mar is None):
            return Code33Result(False, f"missing/invalid YoY base at {label_by_end.get(end, end)}")
        eps_yoy.append(g_eps)
        sales_yoy.append(g_rev)
        margin_yoy.append(g_mar if g_mar is not None else float("nan"))
        labels.append(label_by_end.get(end, end))

    # recent[:3] is most-recent-first, so accelerating == strictly decreasing as
    # we go back in time: yoy[0] > yoy[1] > yoy[2].
    def _accelerating(series: list[float]) -> bool:
        return series[0] > series[1] > series[2]

    legs = [_accelerating(eps_yoy), _accelerating(sales_yoy)]
    if require_margin:
        legs.append(_accelerating(margin_yoy))
    passes = all(legs)
    metric_label = "EPS, sales, and net margin" if require_margin else "EPS and sales"
    return Code33Result(
        passes=passes,
        reason="ok" if passes else f"not accelerating in {metric_label}",
        eps_yoy=eps_yoy,
        sales_yoy=sales_yoy,
        margin_yoy=margin_yoy,
        quarters=labels,
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

    def code33(self, ticker: str, *, require_margin: bool = True) -> Code33Result:
        facts = self.company_facts(ticker)
        if not facts:
            return Code33Result(False, "no EDGAR facts")
        return compute_code33_from_facts(facts, require_margin=require_margin)

    def code33_map(self, tickers: list[str], *, require_margin: bool = False) -> dict[str, bool]:
        """{ticker: passes} for many tickers. Missing/withdrawn filers -> False.

        Pre-warms the CIK map once, then fetches each company's facts. Used to
        stamp ``code33`` onto US scan rows during the static build (EDGAR is
        US-only). Never raises — a fetch failure just yields False for that name.
        """
        out: dict[str, bool] = {}
        for ticker in tickers:
            try:
                out[ticker.upper()] = self.code33(ticker, require_margin=require_margin).passes
            except Exception:  # noqa: BLE001 - one bad symbol must not abort the batch
                out[ticker.upper()] = False
        return out
