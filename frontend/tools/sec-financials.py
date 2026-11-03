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

def series(facts, field, as_of, annual=False):
    tags, unit = TAGS[field]
    instant = field in ("inventory", "receivables")
    candidates = []
    for tag in tags:
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
        ordered = [points[k] for k in sorted(points) if not points[k].get("conflict")]
        if ordered:
            candidates.append(ordered)
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

def normalize(facts, symbol, cik, as_of, retrieved_at=None):
    if not valid_date(as_of) or facts.get("cik") != cik:
        raise ValueError("CIK or as-of mismatch")
    retrieved_at = retrieved_at or now_iso()
    fields = {key: series(facts, key, as_of) for key in TAGS}
    for key in DERIVABLE:
        # Derivation always sees the full 24-point series; trimming comes after.
        fields[key] = derive_fourth_quarters(fields[key], series(facts, key, as_of, annual=True))
    annual_eps = series(facts, "eps", as_of, annual=True)
    if not (fields["eps"] or fields["revenue"] or fields["netIncome"] or annual_eps):
        return unavailable(symbol, as_of, "no_quarterly", "SEC四半期報告なし", retrieved_at, filed_forms(facts))
    ends = [p["end"] for key in ("eps", "revenue") for p in fields[key]]
    if ends:
        cutoff = (date.fromisoformat(max(ends)) - timedelta(days=TRIM_DAYS)).isoformat()
        fields = {key: [p for p in points if p["end"] >= cutoff] for key, points in fields.items()}
    # Annual EPS stays complete: the annual record compares against every prior year.
    return {"schema_version": SCHEMA_VERSION, "symbol": symbol, "cik": cik, "as_of_date": as_of, "retrieved_at": retrieved_at,
        "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
        "status": "available" if fields["eps"] and fields["revenue"] else "partial",
        "quarterly": fields, "annualEps": annual_eps,
        "limitations": ["US GAAP標準タグ・USDの報告値。調整後EPSと同一ではない", "EPSは直接報告された四半期だけを使用。年間EPSからQ4を差し引き推計しない", "売上高・純利益のQ4が年度値だけで報告される場合は、同じ科目の年度値から3四半期を差し引いて算出（算出元を記録）", "提出日までの情報。同日中の発表時刻・決算発表日そのものは未確認", "一時利益・予想値・修正履歴・企業材料は未検証"]}

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

def decode(response):
    raw = response.read()
    headers = getattr(response, "headers", None)
    encoding = (headers.get("Content-Encoding", "") if headers is not None else "") or ""
    if encoding.strip().lower() == "gzip":
        raw = gzip.decompress(raw)
    return json.loads(raw)

def get_json(url, attempts=3, sleep=time.sleep, opener=urlopen, limiter=None):
    """Every attempt, including retries, first takes a slot from the shared limiter."""
    limiter = limiter or LIMITER
    req = Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json", "Accept-Encoding": "gzip"})
    for attempt in range(1, attempts + 1):
        try:
            limiter.wait()
            with opener(req, timeout=30) as response:
                return decode(response)
        except HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == attempts:
                raise
            retry_after = (error.headers or {}).get("Retry-After", "") if hasattr(error, "headers") else ""
            sleep(min(30.0, float(retry_after)) if str(retry_after).isdigit() else 2 ** (attempt - 1))
        except (URLError, TimeoutError):
            if attempt == attempts:
                raise
            sleep(2 ** (attempt - 1))

SECOND_PASS_DELAY_SECONDS = 20
TRANSIENT_ERROR = "SEC取得不可"

def fetch_symbol(symbol, tickers, as_of, get=None):
    """One symbol's record. Permanent outcomes (no CIK, no companyfacts, no quarterly
    report, an invalid payload) carry their reason; only `transient` is retried."""
    get = get or get_json
    cik = tickers.get(symbol.replace(".", "-")) or tickers.get(symbol)
    if not cik:
        return unavailable(symbol, as_of, "no_cik", "SEC識別子未取得", now_iso())
    try:
        facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    except HTTPError as e:
        reason = "no_companyfacts" if e.code == 404 else "transient"
        return unavailable(symbol, as_of, reason, f"{TRANSIENT_ERROR}: {type(e).__name__} {e.code}", now_iso())
    except Exception as e:
        # URLError, timeouts, resets and truncated or undecodable bodies.
        return unavailable(symbol, as_of, "transient", f"{TRANSIENT_ERROR}: {type(e).__name__}", now_iso())
    retrieved_at = now_iso()
    try:
        return normalize(facts, symbol, cik, as_of, retrieved_at)
    except Exception as e:
        return unavailable(symbol, as_of, "invalid_payload", f"{TRANSIENT_ERROR}: {type(e).__name__}", retrieved_at)

def fetch_all(symbols, tickers, as_of, get, workers=WORKERS):
    """Results in the order of `symbols`; the shared limiter bounds the total rate."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda symbol: fetch_symbol(symbol, tickers, as_of, get), symbols))

def collect(symbols, as_of, get=None, sleep=time.sleep, workers=WORKERS):
    """Fetch every symbol, then give the ones that failed transiently one more pass.
    A symbol that still fails stays unavailable (unknown); nothing from an earlier run is reused."""
    get = get or get_json
    output = {"schema_version": SCHEMA_VERSION, "as_of_date": as_of, "retrieved_at": now_iso(), "results": {}, "errors": []}
    tickers = {}
    for attempt in range(2):
        try:
            mapping = get("https://www.sec.gov/files/company_tickers.json")
            tickers = {r["ticker"].upper(): int(r["cik_str"]) for r in mapping.values()}
            break
        except Exception as e:
            if attempt:
                output["errors"].append(f"SEC ticker map unavailable: {type(e).__name__}")
            else:
                sleep(SECOND_PASS_DELAY_SECONDS)
    for symbol, result in zip(symbols, fetch_all(symbols, tickers, as_of, get, workers)):
        output["results"][symbol] = result
    failed = [s for s, r in output["results"].items() if r.get("reason") == "transient"]
    recovered = 0
    if failed:
        sleep(SECOND_PASS_DELAY_SECONDS)
        for symbol, result in zip(failed, fetch_all(failed, tickers, as_of, get, workers)):
            if result.get("status") in ("available", "partial"):
                recovered += 1
            output["results"][symbol] = result
    output["second_pass"] = {"retried": len(failed), "recovered": recovered}
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

def target_symbols(daily, audit):
    """Every row the brief can list comes first (qualified, then one condition short),
    then the trend-template ranking the brief uses, then the other ranked lists."""
    ranked = [r["symbol"] for method in ("minervini", "minervini2", "ibd", "oneil") for r in daily["candidates"].get(method, [])]
    return list(dict.fromkeys(same_day_brief(daily, audit) + ranked))

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
    ordered = target_symbols(daily, audit)
    symbols = requested(ordered, args.limit)
    output = collect(symbols, as_of)
    brief = same_day_brief(daily, audit)
    output["coverage"] = {**coverage(output["results"], len(ordered), len(symbols), brief), "second_pass": output.pop("second_pass")}
    write_output(root, output)
    print(f"SEC evidence {as_of}: " + json.dumps(output["coverage"], ensure_ascii=False) + "; missing remains unknown", flush=True)
    if output["coverage"]["truncated"] > 0:
        print(f"::warning::SEC evidence covers {len(symbols)} of {len(ordered)} eligible symbols; {output['coverage']['truncated']} stay unfetched (unknown)", flush=True)

def coverage(results, eligible, requested, brief=()):
    values = list(results.values())
    derived = lambda key: sum(any(p.get("derived") == DERIVED_Q4 for p in (r.get("quarterly") or {}).get(key, [])) for r in values)
    brief = list(dict.fromkeys(brief))
    return {"eligible": eligible, "requested": requested, "truncated": max(0, eligible - requested),
        "brief_listed": len(brief), "brief_fetched": sum(symbol in results for symbol in brief),
        "available": sum(r.get("status") == "available" for r in values), "partial": sum(r.get("status") == "partial" for r in values),
        "unavailable": sum(r.get("status") == "unavailable" for r in values),
        "reasons": {reason: sum(r.get("reason") == reason for r in values) for reason in UNAVAILABLE_REASONS},
        "q4_revenue_derived": derived("revenue"), "q4_net_income_derived": derived("netIncome")}

if __name__ == "__main__":
    main()
