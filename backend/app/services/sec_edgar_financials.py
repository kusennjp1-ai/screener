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


def compute_code33_from_facts(facts: dict[str, Any]) -> Code33Result:
    """Evaluate Code 33 from a parsed EDGAR companyfacts dict."""
    eps = quarterly_series(facts, EPS_TAGS, is_eps=True)
    rev = quarterly_series(facts, REVENUE_TAGS, is_eps=False)
    ni = quarterly_series(facts, NET_INCOME_TAGS, is_eps=False)
    if not eps or not rev or not ni:
        return Code33Result(False, "missing EPS/revenue/net-income series")

    # Margin per quarter where both revenue and net income exist (revenue > 0).
    margin: dict[tuple[int, int], float] = {}
    for key, r in rev.items():
        n = ni.get(key)
        if n is not None and r and r > 0:
            margin[key] = n / r

    # The three most recent quarters that have all metrics + a year-ago quarter.
    recent = _ordered_quarters(set(eps) & set(rev) & set(margin))
    if len(recent) < 3:
        return Code33Result(False, "fewer than 3 comparable quarters")

    eps_yoy: list[float] = []
    sales_yoy: list[float] = []
    margin_yoy: list[float] = []
    labels: list[str] = []
    for quarter in recent[:3]:
        prior_key = (quarter.fy - 1, quarter.q)
        g_eps = _yoy_growth(eps.get(quarter.key), eps.get(prior_key))
        g_rev = _yoy_growth(rev.get(quarter.key), rev.get(prior_key))
        g_mar = _yoy_growth(margin.get(quarter.key), margin.get(prior_key))
        if g_eps is None or g_rev is None or g_mar is None:
            return Code33Result(False, f"missing/invalid YoY base at FY{quarter.fy} Q{quarter.q}")
        eps_yoy.append(g_eps)
        sales_yoy.append(g_rev)
        margin_yoy.append(g_mar)
        labels.append(f"FY{quarter.fy}Q{quarter.q}")

    # recent[:3] is most-recent-first, so accelerating == strictly decreasing as
    # we go back in time: yoy[0] > yoy[1] > yoy[2].
    def _accelerating(series: list[float]) -> bool:
        return series[0] > series[1] > series[2]

    passes = _accelerating(eps_yoy) and _accelerating(sales_yoy) and _accelerating(margin_yoy)
    return Code33Result(
        passes=passes,
        reason="ok" if passes else "not accelerating in all three metrics",
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

    def code33(self, ticker: str) -> Code33Result:
        facts = self.company_facts(ticker)
        if not facts:
            return Code33Result(False, "no EDGAR facts")
        return compute_code33_from_facts(facts)
