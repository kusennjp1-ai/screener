"""Point-in-time SEC evidence for candidates. Missing facts remain unknown."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import gzip
import json
import math
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_USER_AGENT = "screener-research https://github.com/kusennjp1-ai/screener"
RETRY_STATUS = {429, 500, 502, 503, 504}
# Every row the daily brief can list (about a thousand), then the ranked lists.
MAX_SYMBOLS = 1500
SCHEMA_VERSION = 2
WORKERS = 4
# SEC fair access allows 10 requests/second in total. This stays at 5 by default
# across every worker thread (SEC_MAX_RPS may lower it, or raise it to at most 8).
DEFAULT_RPS = 5.0
MAX_RPS = 8.0
# Only the window the rules read is published: the latest 8 quarters plus the
# year-ago base of the oldest one (about 2.75 years), with a margin.
TRIM_DAYS = 1100
UNAVAILABLE_REASONS = ("no_cik", "no_companyfacts", "no_quarterly", "transient", "invalid_payload")
FORM_PATTERN = re.compile(r"^[0-9A-Z-]{2,8}(/A)?$")
OUTPUT = "book-financials.json.gz"
LEGACY_OUTPUT = "book-financials.json"
# Revenue and net income are additive over a fiscal year, so a fourth quarter the
# filer only reports inside its 10-K can be recovered exactly as the annual value
# minus the three reported quarters of the same concept and fiscal year. EPS is
# never derived this way (share counts differ by quarter).
DERIVED_Q4 = "fiscal-year-minus-three-quarters"
DERIVABLE = ("revenue", "netIncome")

TAGS = {
    "eps": (["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], "USD/shares"),
    "revenue": (["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], "USD"),
    "netIncome": (["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "USD"),
    "inventory": (["InventoryNet"], "USD"),
    "receivables": (["AccountsReceivableNetCurrent", "AccountsNotesAndOtherReceivablesNetCurrent"], "USD"),
}

def valid_date(s):
    try:
        return isinstance(s, str) and date.fromisoformat(s).isoformat() == s
    except ValueError:
        return False

def concept_points(facts, field, tag, as_of, annual=False):
    """One concept's points for a field: the latest filing of each period end, as of the date."""
    return tag_points(facts, tag, TAGS[field][1], field in ("inventory", "receivables"), as_of, annual)

def tag_points(facts, tag, unit, instant, as_of, annual=False):
    """One us-gaap tag's points in one unit (an instant or a 70-105 / 330-400 day flow): the latest filing of
    each period end, as of the date. A period end whose latest filings disagree is dropped."""
    points = {}
    for e in facts.get("facts", {}).get("us-gaap", {}).get(tag, {}).get("units", {}).get(unit, []):
        end, start, filed, value, accession = e.get("end"), e.get("start"), e.get("filed"), e.get("val"), e.get("accn")
        if not valid_date(end) or not valid_date(filed) or filed > as_of or end > as_of or filed < end:
            continue
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
            continue
        # Every fact must name its filing; an unnamed one cannot be audited.
        if not isinstance(accession, str) or not accession.strip() or len(accession) > 64:
            continue
        if not instant:
            if not valid_date(start):
                continue
            duration = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
            lo, hi = (330, 400) if annual else (70, 105)
            if not lo <= duration <= hi:
                continue
        if e.get("form") not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
            continue
        item = {"end": end, "start": None if instant else start, "filed": filed, "value": value, "tag": tag, "unit": unit, "accession": accession, "form": e["form"], "derived": False}
        prior = points.get(end)
        if prior is None or filed > prior["filed"]:
            points[end] = item
        elif filed == prior["filed"] and (value != prior["value"] or start != prior["start"]):
            prior["conflict"] = True
    return [points[k] for k in sorted(points) if not points[k].get("conflict")]

def series(facts, field, as_of, annual=False, tags=None):
    """The field's series in one concept. `tags` limits the concepts considered (the annual values a
    fourth quarter is derived from must be the quarterly series' own concept)."""
    candidates = [points for points in (concept_points(facts, field, tag, as_of, annual) for tag in (tags or TAGS[field][0])) if points]
    # Stay in one concept, without undocumented changes in revenue definition.
    return max(candidates, key=lambda x: (x[-1]["end"], len(x)), default=[])[-24:]

def derive_fourth_quarters(quarters, annual):
    """Add Q4 flow values that are only reported as a fiscal-year total.

    The annual value and its three quarters must share one concept and unit, the
    quarters must tile the fiscal year from its first day without gaps, and the
    remainder must be a 70-105 day quarter. Anything else stays unknown.
    """
    by_end = {p["end"]: p for p in quarters}
    derived = []
    for year in annual:
        if year["end"] in by_end:
            continue
        chain, cursor = [], year["start"]
        for _ in range(3):
            following = [p for p in quarters if p["start"] == cursor and p["tag"] == year["tag"] and p["unit"] == year["unit"]]
            if len(following) != 1:
                break
            chain.append(following[0])
            cursor = (date.fromisoformat(following[0]["end"]) + timedelta(days=1)).isoformat()
        # Every source filing must be identifiable; otherwise the browser rejects the series.
        if len(chain) != 3 or not all(isinstance(p.get("accession"), str) and p["accession"] for p in [year, *chain]):
            continue
        duration = (date.fromisoformat(year["end"]) - date.fromisoformat(cursor)).days + 1
        if not 70 <= duration <= 105:
            continue
        value = year["value"] - sum(p["value"] for p in chain)
        filed = max([year["filed"], *(p["filed"] for p in chain)])
        derived.append({"end": year["end"], "start": cursor, "filed": filed, "value": value, "tag": year["tag"], "unit": year["unit"],
            "accession": year["accession"], "form": year["form"], "derived": DERIVED_Q4,
            "components": [year["accession"], *(p["accession"] for p in chain)]})
    return sorted(quarters + derived, key=lambda p: p["end"])[-24:]

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

# Round-2 record contract (plan section 2.3); older records lack both fields, and the browser admission accepts either.
# - invalid_detail {class, message, requested_cik, received_cik} on a record whose reason is invalid_payload:
#   the exception class, a message of at most 200 characters with no headers or secrets, and both CIKs.
# - derivation_gaps [{fiscal_year, metric, reason}] with reason tag_mismatch, broken_chain or no_annual: each
#   fiscal year whose fourth quarter could not be derived (see DERIVED_Q4 and derivation_gaps). EPS is never derived.
# Examples: frontend/src/test/fixtures/publishedContracts.js.
def unavailable(symbol, as_of, reason, error, retrieved_at, forms=None):
    assert reason in UNAVAILABLE_REASONS
    result = {"schema_version": SCHEMA_VERSION, "symbol": symbol, "as_of_date": as_of, "status": "unavailable", "reason": reason, "error": error, "retrieved_at": retrieved_at}
    if forms is not None:
        result["forms"] = forms
    return result

def filed_forms(facts, limit=5):
    """The most frequent filing forms in the payload (e.g. 20-F for a foreign issuer)."""
    counts = Counter()
    for taxonomy in (facts.get("facts") or {}).values():
        for concept in (taxonomy or {}).values():
            for entries in ((concept or {}).get("units") or {}).values():
                for e in entries or []:
                    form = e.get("form") if isinstance(e, dict) else None
                    if isinstance(form, str) and FORM_PATTERN.match(form):
                        counts[form] += 1
    return [form for form, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]

class PayloadMismatch(ValueError):
    """The companyfacts payload is not the one requested (another CIK) or the analysis date is invalid."""

# A CIK as companyfacts may write it: a non-bool int, or ASCII digits (1-10, zero padding allowed). Nothing else
# (a float, a bool, a signed or spaced string, Unicode digits) names a CIK; the identity check stays exact.
CIK_TEXT = re.compile(r"[0-9]{1,10}")

def payload_cik(value):
    """The payload's CIK as an int, or None when it names none."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and CIK_TEXT.fullmatch(value):
        return int(value)
    return None

def cik_kind(facts):
    """How the payload wrote its cik, for the run's diagnostic count: int, digits (a digit string), missing, null,
    text (another string), not_object (the payload is not an object) or the JSON type's name."""
    if not isinstance(facts, dict):
        return "not_object"
    if "cik" not in facts:
        return "missing"
    value = facts["cik"]
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, str):
        return "digits" if CIK_TEXT.fullmatch(value) else "text"
    return type(value).__name__

DERIVATION_GAP_REASONS = ("tag_mismatch", "broken_chain", "no_annual")

def derivation_gaps(facts, field, quarters, as_of):
    """Each fiscal year whose fourth quarter of `field` stays unknown after derivation, with why.

    `quarters` is the field's series after derivation (one concept). A fiscal year is known from an
    annual value of the field in any of its concepts or from the annual EPS; only years after the
    series' first quarter and without a quarter ending on the fiscal-year end are listed:
    tag_mismatch (only another concept has the annual value), broken_chain (the annual value is in
    the series' own concept, but its three quarters do not tile the year) or no_annual (no annual
    value of the field at all). A field without any quarterly series has no gaps (no concept)."""
    if not quarters:
        return []
    concept = quarters[0]["tag"]
    own = {p["end"] for p in concept_points(facts, field, concept, as_of, annual=True)}
    others = {p["end"] for tag in TAGS[field][0] if tag != concept for p in concept_points(facts, field, tag, as_of, annual=True)}
    fiscal_ends = own | others | {p["end"] for p in series(facts, "eps", as_of, annual=True)}
    have = {p["end"] for p in quarters}
    gaps, seen = [], set()
    for end in sorted(fiscal_ends):
        if end <= quarters[0]["end"] or end in have:
            continue
        reason = "broken_chain" if end in own else "tag_mismatch" if end in others else "no_annual"
        key = (int(end[:4]), field)
        if key not in seen:
            seen.add(key)
            gaps.append({"fiscal_year": key[0], "metric": field, "reason": reason, "end": end})
    return gaps

def trim_cutoff(quarterly):
    """The record's window: TRIM_DAYS before the newest EPS or revenue period end; None (no trim) without either.
    Trimming keeps the newest end, so a trimmed record's quarters give the same cutoff."""
    ends = [p["end"] for key in ("eps", "revenue") for p in quarterly.get(key) or []]
    return (date.fromisoformat(max(ends)) - timedelta(days=TRIM_DAYS)).isoformat() if ends else None

def normalize(facts, symbol, cik, as_of, retrieved_at=None):
    if not valid_date(as_of):
        raise PayloadMismatch("analysis date is not a valid date")
    if payload_cik(facts.get("cik")) != cik:
        raise PayloadMismatch("companyfacts cik does not match the requested cik")
    retrieved_at = retrieved_at or now_iso()
    fields = {key: series(facts, key, as_of) for key in TAGS}
    gaps = []
    for key in DERIVABLE:
        # Derivation always sees the full 24-point series; trimming comes after. The annual values are
        # those of the quarterly series' own concept (a 10-K that also tags a legacy total under another
        # concept never decides which annual value a fourth quarter comes from).
        concept = [fields[key][0]["tag"]] if fields[key] else None
        fields[key] = derive_fourth_quarters(fields[key], series(facts, key, as_of, annual=True, tags=concept) if concept else [])
        gaps += derivation_gaps(facts, key, fields[key], as_of)
    annual_eps = series(facts, "eps", as_of, annual=True)
    if not (fields["eps"] or fields["revenue"] or fields["netIncome"] or annual_eps):
        return unavailable(symbol, as_of, "no_quarterly", "SEC四半期報告なし", retrieved_at, filed_forms(facts))
    cutoff = trim_cutoff(fields)
    if cutoff is not None:
        fields = {key: [p for p in points if p["end"] >= cutoff] for key, points in fields.items()}
        gaps = [gap for gap in gaps if gap["end"] >= cutoff]
    # Annual EPS stays complete: the annual record compares against every prior year.
    return {"schema_version": SCHEMA_VERSION, "symbol": symbol, "cik": cik, "as_of_date": as_of, "retrieved_at": retrieved_at,
        "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
        "status": "available" if fields["eps"] and fields["revenue"] else "partial",
        "quarterly": fields, "annualEps": annual_eps,
        "limitations": ["US GAAP標準タグ・USDの報告値。調整後EPSと同一ではない", "EPSは直接報告された四半期だけを使用。年間EPSからQ4を差し引き推計しない", "売上高・純利益のQ4が年度値だけで報告される場合は、同じ科目の年度値から3四半期を差し引いて算出（算出元を記録）", "提出日までの情報。同日中の発表時刻・決算発表日そのものは未確認", "一時利益・予想値・修正履歴・企業材料は未検証"],
        "derivation_gaps": [{key: gap[key] for key in ("fiscal_year", "metric", "reason")} for gap in sorted(gaps, key=lambda gap: (gap["end"], gap["metric"]))]}

# Round 3 (D3): a reference fiscal-Q4 EPS for a filer that reports its fourth quarter only inside the 10-K. It is a
# 独自計算・参考 value: it lives in its own list (never in quarterly.eps) and never counts toward any gate or score
# (counting it is owner decision OD1). Every threshold below is 独自設定 (the brief's own choice, not an SEC or
# Minervini rule). The tags are kept in their own tuples, never added to TAGS: TAGS defines the record's quarterly
# keys, mirrored by the browser admission's SEC_FIELD_TAGS (two numerator tags already sit in TAGS["netIncome"]).
# 独自設定: the one switch. Off, the reference and its accuracy are computed and logged, and no record carries it.
# OD1: switched on only in a follow-up, after the round-3 UI is live and the owner has seen the published accuracy.
Q4_EPS_REFERENCE_EMIT = False
# 独自設定: the method's name, written into every entry.
Q4_REFERENCE_METHOD = "q4-ni-over-q4-diluted-shares-v1"
# 独自設定: the numerator, tried in this order for each fiscal year (the tag used is recorded).
Q4_REFERENCE_NUMERATOR_TAGS = ("NetIncomeLossAvailableToCommonStockholdersDiluted", "NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLoss")
Q4_REFERENCE_NUMERATOR_UNIT = "USD"
# 独自設定: the share count, weighted-average diluted shares.
Q4_REFERENCE_SHARE_TAGS = ("WeightedAverageNumberOfDilutedSharesOutstanding",)
Q4_REFERENCE_SHARE_UNIT = "shares"
# 独自設定: Q4 shares outside [min(Q1..Q3) x (1 - band), max(Q1..Q3) x (1 + band)] read as a split or a restatement.
Q4_REFERENCE_SHARE_BAND = 0.10
# 独自設定: each of Q1-Q3 must satisfy |reported EPS x shares - net income| <= tolerance x |net income|.
Q4_REFERENCE_CHECK_TOLERANCE = 0.02
# 独自設定: at most this many entries per record (the newest kept).
Q4_REFERENCE_MAX = 4
# 独自設定: the accuracy figure's "within 1 cent or 2%".
Q4_REFERENCE_WITHIN_CENTS = 0.01
Q4_REFERENCE_WITHIN_SHARE = 0.02
# Why a fiscal year's reference stays unknown (checked in this order; the first that applies is tallied):
# no_numerator  no annual value of any numerator tag for the fiscal year
# no_tiling     an annual numerator exists but no tag's three quarters tile the year, or the share facts sit on
#               other period boundaries than the numerator's
# no_shares     the annual or a Q1-Q3 weighted diluted share count is missing
# split_band    the Q4 share count is <= 0 or outside the band of Q1-Q3
# check_failed  a Q1-Q3 quarter has no reported EPS or fails the EPS x shares = net income check (a net income of 0 fails)
# not_finite    the quotient is not a finite number
# `error` (a raising computation, per record) is tallied beside them by fetch_symbol.
Q4_REFERENCE_REFUSALS = ("no_numerator", "no_tiling", "no_shares", "split_band", "check_failed", "not_finite")

def _days(start, end):
    """A period's length in days, both ends inclusive (as tag_points counts them)."""
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1

def _tiling_chain(quarters, start, end):
    """The three quarters that tile a fiscal year from its first day, as derive_fourth_quarters walks them."""
    chain, cursor = [], start
    for _ in range(3):
        following = [p for p in quarters if p["start"] == cursor and p["end"] < end]
        if len(following) != 1:
            return None
        chain.append(following[0])
        cursor = (date.fromisoformat(following[0]["end"]) + timedelta(days=1)).isoformat()
    return chain

def _numerator_q4(numerators, end):
    """The first numerator tag whose annual value and three quarters tile the fiscal year ending on `end`: (tag, the
    exact derived Q4, the Q1-Q3 chain), or a refusal reason. A reported Q4 flow of the year is set aside, so the
    remainder is always the annual value minus three reported quarters (derive_fourth_quarters, unchanged)."""
    annual_seen = False
    for tag in Q4_REFERENCE_NUMERATOR_TAGS:
        quarters, annual = numerators[tag]
        year = annual.get(end)
        if year is None:
            continue
        annual_seen = True
        inside = [p for p in quarters if year["start"] <= p["start"] and p["end"] < end]
        derived = [p for p in derive_fourth_quarters(inside, [year]) if p.get("derived") == DERIVED_Q4 and p["end"] == end]
        chain = _tiling_chain(inside, year["start"], end) if derived else None
        if derived and chain:
            return (tag, year, derived[0], chain), None
    return None, "no_tiling" if annual_seen else "no_numerator"

def _share_chain(shares, year, chain):
    """The share tag's annual and Q1-Q3 weighted counts on exactly the numerator chain's period boundaries:
    (tag, annual, [q1, q2, q3]), or a refusal reason (no_shares when a fact is missing, no_tiling when it sits on
    other boundaries)."""
    reason = "no_shares"
    for tag in Q4_REFERENCE_SHARE_TAGS:
        quarters, annual = shares[tag]
        points = [annual.get(year["end"]), *(quarters.get(p["end"]) for p in chain)]
        if any(point is None for point in points):
            continue
        if points[0]["start"] != year["start"] or any(point["start"] != p["start"] for point, p in zip(points[1:], chain)):
            reason = "no_tiling"
            continue
        return (tag, points[0], points[1:]), None
    return None, reason

def _q4_reference_year(end, numerators, shares, eps_by_end, q1_q3_samples):
    """One fiscal year's reference Q4 EPS: (value, the entry), or (None, a refusal reason). The Q1-Q3 accuracy samples
    (net income / weighted shares against the reported EPS) are appended once the year tiles, before the check."""
    numerator, reason = _numerator_q4(numerators, end)
    if numerator is None:
        return None, reason
    tag, year, q4, chain = numerator
    share, reason = _share_chain(shares, year, chain)
    if share is None:
        return None, reason
    share_tag, share_year, share_quarters = share
    reported = []
    for p, s in zip(chain, share_quarters):
        eps = eps_by_end.get(p["end"])
        eps = eps if eps is not None and eps["start"] == p["start"] else None
        reported.append(eps)
        if eps is not None and s["value"] > 0:
            ratio = p["value"] / s["value"]
            if math.isfinite(ratio):
                q1_q3_samples.append((round(ratio, 4), eps["value"]))
    values = [s["value"] for s in share_quarters]
    q4_days = _days(q4["start"], end)
    q4_shares = (share_year["value"] * _days(year["start"], end) - sum(s["value"] * _days(p["start"], p["end"]) for p, s in zip(chain, share_quarters))) / q4_days
    if not math.isfinite(q4_shares) or q4_shares <= 0 or not min(values) * (1 - Q4_REFERENCE_SHARE_BAND) <= q4_shares <= max(values) * (1 + Q4_REFERENCE_SHARE_BAND):
        return None, "split_band"
    for p, s, eps in zip(chain, share_quarters, reported):
        if eps is None or p["value"] == 0 or not abs(eps["value"] * s["value"] - p["value"]) <= Q4_REFERENCE_CHECK_TOLERANCE * abs(p["value"]):
            return None, "check_failed"
    value = q4["value"] / q4_shares
    if not math.isfinite(value):
        return None, "not_finite"
    value = round(value, 4) + 0.0
    return value, {"end": end, "start": q4["start"], "value": value, "method": Q4_REFERENCE_METHOD,
        "numerator": {"tag": tag, "components": list(q4["components"])},
        "shares": {"tag": share_tag, "components": [share_year["accession"], *(s["accession"] for s in share_quarters)]}}

def q4_eps_reference(facts, as_of, eps_quarters, cutoff=None):
    """A 独自計算・参考 fiscal-Q4 EPS for each fiscal year whose fourth quarter has no reported quarterly EPS.

    Per fiscal year (an annual 330-400 day fact): the Q4 net income is the exact derive_fourth_quarters remainder
    (annual minus three reported quarters, one numerator tag, each fact named by its accession), and the Q4 weighted
    diluted shares are (annual weighted shares x fiscal-year days - sum(quarter weighted shares x quarter days)) /
    Q4 days, on the numerator chain's own period boundaries. The share remainder is exact for basic shares (a
    weighted average over days is additive) and only approximate for diluted shares (incremental shares and
    anti-dilution are decided per period). The value stays unknown (no entry, the reason tallied) for the reasons in
    Q4_REFERENCE_REFUSALS. `eps_quarters` is the untrimmed quarterly EPS series the record is trimmed from.

    Returns (entries, samples, refusals):
    - entries: the record's reference list, sorted by end, only fiscal-year ends on or after `cutoff` (the record's
      trim) without a reported quarterly EPS, at most Q4_REFERENCE_MAX (the newest kept);
    - samples: {"q4": [(reference, reported)], "q1_q3": [(net income / shares, reported)]}, never written into a
      record: q4 for fiscal years whose Q4 EPS is reported (computed under the same refusal rules), q1_q3 for every
      Q1-Q3 quarter of every fiscal year that tiles, before the EPS check;
    - refusals: a Counter of reasons over the fiscal years that could carry an entry (in the window, Q4 EPS not reported).
    """
    numerators = {tag: (tag_points(facts, tag, Q4_REFERENCE_NUMERATOR_UNIT, False, as_of),
        {p["end"]: p for p in tag_points(facts, tag, Q4_REFERENCE_NUMERATOR_UNIT, False, as_of, annual=True)}) for tag in Q4_REFERENCE_NUMERATOR_TAGS}
    shares = {tag: ({p["end"]: p for p in tag_points(facts, tag, Q4_REFERENCE_SHARE_UNIT, False, as_of)},
        {p["end"]: p for p in tag_points(facts, tag, Q4_REFERENCE_SHARE_UNIT, False, as_of, annual=True)}) for tag in Q4_REFERENCE_SHARE_TAGS}
    eps_by_end = {p["end"]: p for p in eps_quarters}
    # A fiscal year is known from an annual numerator, an annual share count or the annual EPS (as derivation_gaps does).
    fiscal_ends = {end for _, annual in numerators.values() for end in annual} | {end for _, annual in shares.values() for end in annual} \
        | {p["end"] for p in series(facts, "eps", as_of, annual=True)}
    entries, samples, refusals = [], {"q4": [], "q1_q3": []}, Counter()
    for end in sorted(fiscal_ends):
        value, result = _q4_reference_year(end, numerators, shares, eps_by_end, samples["q1_q3"])
        reported = eps_by_end.get(end)
        if reported is not None:
            # The Q4 EPS is reported: never an entry, only an accuracy sample on the same quarter.
            if value is not None and reported["start"] == result["start"]:
                samples["q4"].append((value, reported["value"]))
            continue
        if cutoff is not None and end < cutoff:
            continue
        if value is None:
            refusals[result] += 1
        else:
            entries.append(result)
    return entries[-Q4_REFERENCE_MAX:], samples, refusals

def q4_reference_accuracy(samples):
    """The accuracy of (reference, reported) pairs: n, the median absolute error, how many are within 1 cent or 2%
    and their share. With no sample nothing is measured: every figure but n is null, never 0."""
    n = len(samples)
    if not n:
        return {"n": 0, "median_abs_error": None, "within_1c_or_2pct": None, "share": None}
    # Rounded to 6 places first, so a difference of exactly 1 cent is not lost to binary floating point.
    errors = [round(abs(reference - reported), 6) for reference, reported in samples]
    within = sum(error <= Q4_REFERENCE_WITHIN_CENTS or error <= round(Q4_REFERENCE_WITHIN_SHARE * abs(reported), 6) for error, (_, reported) in zip(errors, samples))
    ordered = sorted(errors)
    middle = n // 2
    median = ordered[middle] if n % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return {"n": n, "median_abs_error": round(median, 4), "within_1c_or_2pct": within, "share": round(within / n, 4)}

def q4_reference_summary(records_with_reference, entries, refused, samples):
    """The run's aggregate (no symbols): logged, added to the step summary and written as the file's coverage.q4_reference."""
    return {"emit": Q4_EPS_REFERENCE_EMIT, "records_with_reference": records_with_reference, "entries": entries,
        "refused": {reason: refused.get(reason, 0) for reason in (*Q4_REFERENCE_REFUSALS, "error")},
        "q4": q4_reference_accuracy(samples["q4"]), "q1_q3": q4_reference_accuracy(samples["q1_q3"])}

def q4_reference_line(as_of, summary):
    return f"SEC q4 reference accuracy {as_of}: " + json.dumps(summary, ensure_ascii=False, allow_nan=False)

def attach_q4_reference(record, facts, as_of, tally=None):
    """Compute the record's reference after a successful normalize, apart from it: a raising computation leaves the
    record exactly as normalize returned it and is tallied as `error`. The entries are attached as q4EpsReference only
    when Q4_EPS_REFERENCE_EMIT is on; the samples and refusals go to `tally` either way."""
    try:
        result = q4_eps_reference(facts, as_of, series(facts, "eps", as_of), trim_cutoff(record["quarterly"]))
    except Exception:
        if tally is not None:
            tally([], {"q4": [], "q1_q3": []}, Counter({"error": 1}))
        return record
    entries, samples, refusals = result
    if tally is not None:
        tally(entries, samples, refusals)
    if Q4_EPS_REFERENCE_EMIT and entries:
        record["q4EpsReference"] = entries
    return record

INVALID_MESSAGE_MAX = 200
_SECRET_PATTERNS = (re.compile(r"https?://\S+"), re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"(?i)\b(?:authorization|cookie|set-cookie|user-agent|x-[a-z-]+)\s*[:=]\s*\S+"))

def safe_message(text, fallback):
    """An exception message fit to publish: no URL, address, header or the User-Agent, one line, at most 200 characters."""
    text = str(text or "")
    agent = user_agent()
    if agent:
        text = text.replace(agent, " ")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(" ", text)
    text = re.sub(r"\s+", " ", "".join(ch if ch.isprintable() else " " for ch in text)).strip()
    return (text or fallback)[:INVALID_MESSAGE_MAX]

def invalid_detail(error, cik, facts):
    """Why a payload could not be read: the exception class, a short message and the CIKs requested and received."""
    received = payload_cik(facts.get("cik")) if isinstance(facts, dict) else None
    name = type(error).__name__
    return {"class": name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) else "Exception", "message": safe_message(error, name),
        "requested_cik": cik, "received_cik": received}

def invalid_cause(record):
    """The cause key of an invalid_payload record for the counts: cik_mismatch, or the exception class."""
    detail = record.get("invalid_detail") if isinstance(record.get("invalid_detail"), dict) else {}
    requested, received = detail.get("requested_cik"), detail.get("received_cik")
    if isinstance(requested, int) and isinstance(received, int) and requested != received:
        return "cik_mismatch"
    return detail.get("class") or "unrecorded"

def user_agent():
    # SEC asks for a contactable User-Agent; CI passes the repository secret.
    return os.environ.get("SEC_USER_AGENT", "").strip() or DEFAULT_USER_AGENT

class RateLimiter:
    """Spaces requests at least 1/rate seconds apart across every thread."""

    def __init__(self, rate, clock=time.monotonic, sleep=time.sleep):
        if not (isinstance(rate, (int, float)) and math.isfinite(rate) and rate > 0):
            raise ValueError("rate must be positive")
        self.interval, self.clock, self.sleep = 1.0 / rate, clock, sleep
        self.lock, self.next_slot = threading.Lock(), None

    def wait(self):
        with self.lock:
            now = self.clock()
            slot = now if self.next_slot is None or self.next_slot <= now else self.next_slot
            self.next_slot = slot + self.interval
        if slot > now:
            self.sleep(slot - now)
        return slot

def sec_rate(environ=None):
    environ = os.environ if environ is None else environ
    try:
        rate = float(environ.get("SEC_MAX_RPS", "") or DEFAULT_RPS)
    except ValueError:
        rate = DEFAULT_RPS
    return min(MAX_RPS, rate) if math.isfinite(rate) and rate > 0 else DEFAULT_RPS

LIMITER = RateLimiter(sec_rate())

# One wall-clock budget for the whole run (ticker map, both passes, every retry), so a hanging
# data.sec.gov can never outlast the job. A symbol not fetched in time stays `transient` (unknown);
# nothing from an earlier run is reused. SEC_DEADLINE_SECONDS may set it (at most MAX_DEADLINE_SECONDS).
DEFAULT_DEADLINE_SECONDS = 900
MAX_DEADLINE_SECONDS = 3600
DEADLINE_ERROR = "期限切れ（未取得）"

class DeadlineExceeded(Exception):
    """The run's SEC budget is spent: the request is not made."""

class Deadline:
    def __init__(self, seconds, clock=time.monotonic):
        self.seconds, self.clock = seconds, clock
        self.end = clock() + seconds

    def remaining(self):
        return self.end - self.clock()

    def expired(self):
        return self.remaining() <= 0

def sec_deadline_seconds(environ=None):
    environ = os.environ if environ is None else environ
    try:
        value = float(environ.get("SEC_DEADLINE_SECONDS", "") or DEFAULT_DEADLINE_SECONDS)
    except ValueError:
        value = DEFAULT_DEADLINE_SECONDS
    return min(MAX_DEADLINE_SECONDS, value) if math.isfinite(value) and value > 0 else DEFAULT_DEADLINE_SECONDS

def decode(response):
    raw = response.read()
    headers = getattr(response, "headers", None)
    encoding = (headers.get("Content-Encoding", "") if headers is not None else "") or ""
    if encoding.strip().lower() == "gzip":
        raw = gzip.decompress(raw)
    return json.loads(raw)

def get_json(url, attempts=3, sleep=time.sleep, opener=urlopen, limiter=None, deadline=None):
    """Every attempt, including retries, first takes a slot from the shared limiter. With a
    `deadline`, no attempt or backoff starts once it has passed, and a socket wait never runs past it."""
    limiter = limiter or LIMITER
    req = Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json", "Accept-Encoding": "gzip"})
    def pause(seconds):
        if deadline is not None and seconds >= deadline.remaining():
            raise DeadlineExceeded(url)
        sleep(seconds)
    for attempt in range(1, attempts + 1):
        try:
            limiter.wait()
            if deadline is not None and deadline.expired():
                raise DeadlineExceeded(url)
            timeout = 30.0 if deadline is None else max(1.0, min(30.0, deadline.remaining()))
            with opener(req, timeout=timeout) as response:
                return decode(response)
        except HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == attempts:
                raise
            retry_after = (error.headers or {}).get("Retry-After", "") if hasattr(error, "headers") else ""
            pause(min(30.0, float(retry_after)) if str(retry_after).isdigit() else 2 ** (attempt - 1))
        except (URLError, TimeoutError):
            if attempt == attempts:
                raise
            pause(2 ** (attempt - 1))

SECOND_PASS_DELAY_SECONDS = 20
TRANSIENT_ERROR = "SEC取得不可"

def fetch_symbol(symbol, tickers, as_of, get=None, deadline=None, observe=None, q4_reference=None):
    """One symbol's record. Permanent outcomes (no CIK, no companyfacts, no quarterly
    report, an invalid payload) carry their reason; only `transient` is retried. Once the
    run's deadline has passed no request is made and the symbol stays transient (unknown).
    After a successful normalize the reference fiscal-Q4 EPS is computed apart from it
    (attach_q4_reference); `q4_reference` receives its entries, samples and refusals."""
    get = get or get_json
    cik = tickers.get(symbol.replace(".", "-")) or tickers.get(symbol)
    if not cik:
        return unavailable(symbol, as_of, "no_cik", "SEC識別子未取得", now_iso())
    if deadline is not None and deadline.expired():
        return unavailable(symbol, as_of, "transient", f"{TRANSIENT_ERROR}: {DEADLINE_ERROR}", now_iso())
    try:
        facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    except DeadlineExceeded:
        return unavailable(symbol, as_of, "transient", f"{TRANSIENT_ERROR}: {DEADLINE_ERROR}", now_iso())
    except HTTPError as e:
        reason = "no_companyfacts" if e.code == 404 else "transient"
        return unavailable(symbol, as_of, reason, f"{TRANSIENT_ERROR}: {type(e).__name__} {e.code}", now_iso())
    except Exception as e:
        # URLError, timeouts, resets and truncated or undecodable bodies.
        return unavailable(symbol, as_of, "transient", f"{TRANSIENT_ERROR}: {type(e).__name__}", now_iso())
    retrieved_at = now_iso()
    try:
        record = normalize(facts, symbol, cik, as_of, retrieved_at)
    except Exception as e:
        record = {**unavailable(symbol, as_of, "invalid_payload", f"{TRANSIENT_ERROR}: {type(e).__name__}", retrieved_at), "invalid_detail": invalid_detail(e, cik, facts)}
    # Diagnostic only (the run's log): how each received payload wrote its cik, by outcome. Never in the record.
    if observe is not None:
        observe(cik_kind(facts), record.get("reason") or "read")
    # Outside normalize's try: the reference can never turn a readable payload into invalid_payload.
    if record.get("status") in ("available", "partial"):
        record = attach_q4_reference(record, facts, as_of, q4_reference)
    return record

def fetch_all(symbols, tickers, as_of, get, workers=WORKERS, deadline=None, observe=None, q4_reference=None):
    """Results in the order of `symbols`; the shared limiter bounds the total rate."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda symbol: fetch_symbol(symbol, tickers, as_of, get, deadline, observe, q4_reference), symbols))

# The second pass is skipped when SEC failed broadly: more than half of the requested symbols,
# and at least this many, failed transiently (retrying them would only spend the budget again).
SECOND_PASS_BROAD_FAILURE = 20

def collect(symbols, as_of, get=None, sleep=time.sleep, workers=WORKERS, deadline=None):
    """Fetch every symbol, then give the ones that failed transiently one more pass, all within
    one wall-clock budget. A symbol that still fails, or is not reached in time, stays unavailable
    (unknown); nothing from an earlier run is reused."""
    deadline = deadline or Deadline(sec_deadline_seconds())
    get = get or (lambda url: get_json(url, deadline=deadline))
    output = {"schema_version": SCHEMA_VERSION, "as_of_date": as_of, "retrieved_at": now_iso(), "results": {}, "errors": []}
    kinds, lock = Counter(), threading.Lock()
    def observe(kind, outcome):
        with lock:
            kinds[f"{kind}:{outcome}"] += 1
    # The reference fiscal-Q4 EPS (D3), aggregated over every record read; main() logs it and writes only the aggregate.
    reference = {"records": 0, "entries": 0, "refused": Counter(), "samples": {"q4": [], "q1_q3": []}}
    def q4_reference(entries, samples, refusals):
        with lock:
            reference["records"] += bool(entries)
            reference["entries"] += len(entries)
            reference["refused"].update(refusals)
            for key in ("q4", "q1_q3"):
                reference["samples"][key] += samples[key]
    tickers = {}
    for attempt in range(2):
        try:
            mapping = get("https://www.sec.gov/files/company_tickers.json")
            tickers = {r["ticker"].upper(): int(r["cik_str"]) for r in mapping.values()}
            break
        except Exception as e:
            if attempt or deadline.remaining() <= SECOND_PASS_DELAY_SECONDS:
                output["errors"].append(f"SEC ticker map unavailable: {type(e).__name__}")
                break
            sleep(SECOND_PASS_DELAY_SECONDS)
    for symbol, result in zip(symbols, fetch_all(symbols, tickers, as_of, get, workers, deadline, observe, q4_reference)):
        output["results"][symbol] = result
    failed = [s for s, r in output["results"].items() if r.get("reason") == "transient"]
    requested = sum(r.get("reason") != "no_cik" for r in output["results"].values())
    broad = len(failed) >= SECOND_PASS_BROAD_FAILURE and len(failed) * 2 > requested
    skipped = None if not failed else "deadline" if deadline.remaining() <= SECOND_PASS_DELAY_SECONDS else "broad_failure" if broad else None
    recovered = 0
    if failed and not skipped:
        sleep(SECOND_PASS_DELAY_SECONDS)
        for symbol, result in zip(failed, fetch_all(failed, tickers, as_of, get, workers, deadline, observe, q4_reference)):
            if result.get("status") in ("available", "partial"):
                recovered += 1
            output["results"][symbol] = result
    output["second_pass"] = {"retried": 0 if skipped else len(failed), "recovered": recovered, **({"skipped": skipped} if skipped else {})}
    unreached = sum(DEADLINE_ERROR in (r.get("error") or "") for r in output["results"].values())
    output["deadline"] = {"seconds": deadline.seconds, "expired": deadline.expired(), "unreached": unreached}
    # Every payload received (both passes), by how it wrote its cik and the outcome; main() logs it and never writes it.
    output["payload_cik"] = dict(sorted(kinds.items()))
    # Aggregates only (no symbols); main() moves it into the file's coverage block and logs it.
    output["q4_reference"] = q4_reference_summary(reference["records"], reference["entries"], reference["refused"], reference["samples"])
    return output

def brief_targets(audit):
    """Every symbol the daily brief can list for the trend template: qualified first, then
    the ones one condition short with nothing unknown. The ranked top-50 lists come first."""
    rows = (audit or {}).get("results", [])
    method = lambda row: (row.get("methods") or {}).get("minervini") or {}
    qualified = [row["symbol"] for row in rows if method(row).get("qualified")]
    near = [row["symbol"] for row in rows if not method(row).get("qualified") and method(row).get("failed") == 1 and method(row).get("unknown") == 0]
    return qualified + near

def same_day_brief(daily, audit):
    # A stale audit (another analysis date) never widens today's list.
    return brief_targets(audit) if audit and audit.get("as_of_date") == daily["as_of_date"] else []

# A stock the brief listed in any of the last RECENT_SESSIONS publications keeps its SEC record after it
# drops off the list (a watched stock), and so does a strong row one condition from the template.
RECENT_SESSIONS = 10
RS_TARGET = 80
HISTORY_INDEX = "candidate-history/index.json"
HISTORY_PATH = re.compile(r"candidate-history/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?")

def snapshot_listed(snapshot):
    """The symbols one published candidate snapshot listed for the trend template: qualified, or one
    condition short with nothing unknown (the brief's rule, from the snapshot's minervini rule states)."""
    listed = []
    for record in (snapshot or {}).get("records") or []:
        method = ((record or {}).get("methods") or {}).get("minervini") or {}
        states = [rule[0] for rule in method.get("rules") or [] if isinstance(rule, list) and rule]
        if not isinstance(record.get("symbol"), str):
            continue
        if method.get("state") == "pass" or (method.get("state") == "fail" and states.count("fail") == 1 and states.count("unknown") == 0):
            listed.append(record["symbol"])
    return listed

def recent_listed(root, as_of, sessions=RECENT_SESSIONS, log=print):
    """Symbols listed in any of the last `sessions` publications before `as_of`, from the restored
    candidate history; None (logged) when it is absent or unreadable: nothing is guessed."""
    import hashlib
    try:
        catalog = json.loads((root / HISTORY_INDEX).read_text(encoding="utf-8"))
        refs = sorted((ref for ref in catalog.get("snapshots") or [] if isinstance(ref, dict) and isinstance(ref.get("as_of"), str) and ref["as_of"] < as_of), key=lambda ref: ref["as_of"])[-sessions:]
        symbols = []
        for ref in refs:
            if not HISTORY_PATH.fullmatch(str(ref.get("path"))):
                raise ValueError("unexpected history path")
            raw = (root / ref["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != ref.get("sha256"):
                raise ValueError("history integrity")
            snapshot = json.loads(gzip.decompress(raw) if ref["path"].endswith(".gz") else raw)
            if snapshot.get("as_of") != ref["as_of"]:
                raise ValueError("history date")
            symbols += snapshot_listed(snapshot)
        return {"symbols": list(dict.fromkeys(symbols)), "sessions": len(refs)}
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        log(f"SEC targets: recently listed symbols skipped (candidate history unavailable: {type(error).__name__})", flush=True)
        return None

# A strong row is near the template: at most this many failed conditions (and one unknown) beside RS推計 ≥ RS_TARGET.
STRONG_MAX_FAILED = 2

def strong_rows(audit, as_of):
    """Same-day audit rows near the trend template: RS推計 of RS_TARGET or more, at most STRONG_MAX_FAILED failed
    and at most one unknown condition."""
    if not audit or audit.get("as_of_date") != as_of:
        return []
    out = []
    for row in audit.get("results") or []:
        method = (row.get("methods") or {}).get("minervini") or {}
        rs = next((rule.get("value") for rule in method.get("rules") or [] if isinstance(rule, dict) and str(rule.get("label", "")).startswith("RS 推計")), None)
        counts = [method.get(key) for key in ("failed", "unknown")]
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in counts):
            continue
        if isinstance(rs, (int, float)) and not isinstance(rs, bool) and math.isfinite(rs) and rs >= RS_TARGET and counts[0] <= STRONG_MAX_FAILED and counts[1] <= 1:
            out.append(row["symbol"])
    return out

def core_targets(daily, audit, recent=None):
    """The rows the brief lists or listed and the ranked lists, in order: every row the brief can list first
    (qualified, then one condition short), then the rows it listed in the last RECENT_SESSIONS publications, then
    the trend-template ranking the brief uses and the other ranked lists. A cut among these is a coverage gap."""
    ranked = [r["symbol"] for method in ("minervini", "minervini2", "ibd", "oneil") for r in daily["candidates"].get(method, [])]
    return list(dict.fromkeys(same_day_brief(daily, audit) + list((recent or {}).get("symbols") or []) + ranked))

def target_symbols(daily, audit, recent=None):
    """core_targets, then the strong rows near the template (RS推計 ≥ 80) as a best-effort tail."""
    return list(dict.fromkeys(core_targets(daily, audit, recent) + strong_rows(audit, daily["as_of_date"])))

def target_counts(core, ordered, symbols):
    """What the fetch committed to and what it cut. `eligible` is every core target plus the strong rows that were
    requested (so the records with quarters never exceed it) and `truncated` the core targets the limit cut; the
    strong rows the limit left out are best effort, counted apart (`strong_rows_unfetched`), never as truncation."""
    core, chosen = set(core), set(symbols)
    tail = [symbol for symbol in ordered if symbol not in core]
    strong_requested = sum(symbol in chosen for symbol in tail)
    return {"eligible": len(core) + strong_requested, "truncated": sum(symbol not in chosen for symbol in core),
        "strong_rows_requested": strong_requested, "strong_rows_unfetched": len(tail) - strong_requested}

def requested(ordered, limit):
    return ordered[:max(0, min(limit, MAX_SYMBOLS))]

def write_output(root, output):
    """Deterministic gzip (mtime 0). The legacy raw file is removed so it is never published stale."""
    body = json.dumps(output, ensure_ascii=False, allow_nan=False).encode("utf-8")
    (root / OUTPUT).write_bytes(gzip.compress(body, compresslevel=9, mtime=0))
    (root / LEGACY_OUTPUT).unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=MAX_SYMBOLS)
    args = parser.parse_args()
    root = Path("public/static-data")
    daily = json.loads(Path("public/research-daily.json").read_text(encoding="utf-8"))
    as_of = daily["as_of_date"]
    audit_path = Path("public/qualification-audit.json")
    audit = json.loads(audit_path.read_text(encoding="utf-8")) if audit_path.exists() else None
    recent = recent_listed(root, as_of)
    core = core_targets(daily, audit, recent)
    ordered = target_symbols(daily, audit, recent)
    symbols = requested(ordered, args.limit)
    output = collect(symbols, as_of)
    brief = same_day_brief(daily, audit)
    counts = target_counts(core, ordered, symbols)
    targets = {"listed": len(brief), "recent_listed": None if recent is None else len(set(recent["symbols"]) - set(brief)), "recent_sessions": None if recent is None else recent["sessions"],
        "strong_rows": len(set(strong_rows(audit, as_of)) - set(brief) - set((recent or {}).get("symbols") or [])),
        "strong_rows_requested": counts["strong_rows_requested"], "strong_rows_unfetched": counts["strong_rows_unfetched"]}
    payload_ciks = output.pop("payload_cik")
    q4_reference = output.pop("q4_reference")
    # coverage.q4_reference: the reference fiscal-Q4 EPS aggregate at file level (no symbols; not a record key). The
    # coverage report's --sec-evidence line prints it from the published file.
    output["coverage"] = {**coverage(output["results"], counts["eligible"], len(symbols), brief), "targets": targets, "second_pass": output.pop("second_pass"), "deadline": output.pop("deadline"),
        "q4_reference": q4_reference}
    write_output(root, output)
    print(f"SEC evidence {as_of}: " + json.dumps(output["coverage"], ensure_ascii=False) + "; missing remains unknown", flush=True)
    summary = invalid_summary(output["results"])
    print(f"SEC invalid_payload {as_of}: " + json.dumps(summary, ensure_ascii=False), flush=True)
    print(f"SEC payload cik {as_of}: " + json.dumps(payload_ciks, ensure_ascii=False), flush=True)
    print(q4_reference_line(as_of, q4_reference), flush=True)
    append_step_summary(f"- SEC evidence {as_of}: {output['coverage']['available']} available, {output['coverage']['partial']} partial, {output['coverage']['unavailable']} unavailable of {len(symbols)} requested; "
        f"invalid_payload {summary['count']} by cause {json.dumps(summary['by_cause'], ensure_ascii=False)}; first symbols {' '.join(summary['symbols']) or 'none'}; "
        f"payload cik {json.dumps(payload_ciks, ensure_ascii=False)}")
    append_step_summary(f"- {q4_reference_line(as_of, q4_reference)}")
    if output["coverage"]["truncated"] > 0:
        print(f"::warning::SEC evidence covers {len(symbols)} of {len(core)} listed, recent and ranked symbols; {output['coverage']['truncated']} of them stay unfetched (unknown)", flush=True)
    if counts["strong_rows_unfetched"] > 0:
        print(f"SEC targets: {counts['strong_rows_unfetched']} strong rows beyond the limit of {MAX_SYMBOLS} stay unfetched (best effort, unknown)", flush=True)
    if output["coverage"]["deadline"]["unreached"] > 0:
        print(f"::warning::SEC budget of {output['coverage']['deadline']['seconds']:.0f}s ran out; {output['coverage']['deadline']['unreached']} symbols stay unfetched (transient, unknown)", flush=True)

def invalid_summary(results, limit=10):
    """invalid_payload records by cause (cik_mismatch or the exception class) and the first `limit` symbols."""
    invalid = [(symbol, record) for symbol, record in results.items() if record.get("reason") == "invalid_payload"]
    return {"count": len(invalid), "by_cause": dict(sorted(Counter(invalid_cause(record) for _, record in invalid).items())), "symbols": [symbol for symbol, _ in invalid[:limit]]}

def append_step_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    except OSError:
        pass

def coverage(results, eligible, requested, brief=()):
    values = list(results.values())
    derived = lambda key: sum(any(p.get("derived") == DERIVED_Q4 for p in (r.get("quarterly") or {}).get(key, [])) for r in values)
    brief = list(dict.fromkeys(brief))
    return {"eligible": eligible, "requested": requested, "truncated": max(0, eligible - requested),
        "brief_listed": len(brief), "brief_fetched": sum(symbol in results for symbol in brief),
        "available": sum(r.get("status") == "available" for r in values), "partial": sum(r.get("status") == "partial" for r in values),
        "unavailable": sum(r.get("status") == "unavailable" for r in values),
        "reasons": {reason: sum(r.get("reason") == reason for r in values) for reason in UNAVAILABLE_REASONS},
        "q4_revenue_derived": derived("revenue"), "q4_net_income_derived": derived("netIncome"),
        # Records with quarters but no revenue concept in TAGS (banks, insurers): a scope limit, never a gap.
        "no_revenue_concept": sum(r.get("status") in ("available", "partial") and not (r.get("quarterly") or {}).get("revenue") for r in values),
        "derivation_gaps": dict(sorted(Counter(f"{gap['metric']}:{gap['reason']}" for r in values for gap in r.get("derivation_gaps") or []).items())),
        "invalid_payload_by_cause": dict(sorted(Counter(invalid_cause(r) for r in values if r.get("reason") == "invalid_payload").items()))}

if __name__ == "__main__":
    main()
