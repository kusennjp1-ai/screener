"""Point-in-time SEC evidence for candidates. Missing facts remain unknown."""
import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_USER_AGENT = "screener-research https://github.com/kusennjp1-ai/screener"
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_SYMBOLS = 300
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
    candidates = []
    for tag in tags:
        points = {}
        for e in facts.get("facts", {}).get("us-gaap", {}).get(tag, {}).get("units", {}).get(unit, []):
            end, start, filed, value = e.get("end"), e.get("start"), e.get("filed"), e.get("val")
            if not valid_date(end) or not valid_date(filed) or filed > as_of or end > as_of or filed < end:
                continue
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
                continue
            if field not in ("inventory", "receivables"):
                if not valid_date(start):
                    continue
                duration = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
                lo, hi = (330, 400) if annual else (70, 105)
                if not lo <= duration <= hi:
                    continue
            if e.get("form") not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
                continue
            item = {"end": end, "start": start, "filed": filed, "value": value, "tag": tag, "unit": unit, "accession": e.get("accn"), "form": e["form"], "derived": False}
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
        if len(chain) != 3:
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

def normalize(facts, symbol, cik, as_of):
    if not valid_date(as_of) or facts.get("cik") != cik:
        raise ValueError("CIK or as-of mismatch")
    fields = {key: series(facts, key, as_of) for key in TAGS}
    for key in DERIVABLE:
        fields[key] = derive_fourth_quarters(fields[key], series(facts, key, as_of, annual=True))
    return {"schema_version": 1, "symbol": symbol, "cik": cik, "as_of_date": as_of,
        "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
        "status": "available" if fields["eps"] and fields["revenue"] else "partial",
        "quarterly": fields, "annualEps": series(facts, "eps", as_of, annual=True),
        "limitations": ["US GAAP標準タグ・USDの報告値。調整後EPSと同一ではない", "EPSは直接報告された四半期だけを使用。年間EPSからQ4を差し引き推計しない", "売上高・純利益のQ4が年度値だけで報告される場合は、同じ科目の年度値から3四半期を差し引いて算出（算出元を記録）", "提出日までの情報。同日中の発表時刻・決算発表日そのものは未確認", "一時利益・予想値・修正履歴・企業材料は未検証"]}

def user_agent():
    # SEC asks for a contactable User-Agent; CI passes the repository secret.
    return os.environ.get("SEC_USER_AGENT", "").strip() or DEFAULT_USER_AGENT

def get_json(url, attempts=3, sleep=time.sleep, opener=urlopen):
    req = Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json"})
    for attempt in range(1, attempts + 1):
        try:
            with opener(req, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == attempts:
                raise
            retry_after = (error.headers or {}).get("Retry-After", "") if hasattr(error, "headers") else ""
            sleep(min(30.0, float(retry_after)) if str(retry_after).isdigit() else 2 ** (attempt - 1))
        except (URLError, TimeoutError):
            if attempt == attempts:
                raise
            sleep(2 ** (attempt - 1))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=60)
    args = parser.parse_args()
    root = Path("public/static-data")
    daily = json.loads(Path("public/research-daily.json").read_text(encoding="utf-8"))
    as_of = daily["as_of_date"]
    ordered = list(dict.fromkeys(r["symbol"] for method in ("minervini2", "minervini", "ibd", "oneil") for r in daily["candidates"].get(method, [])))
    symbols = ordered[:max(0, min(args.limit, MAX_SYMBOLS))]
    output = {"schema_version": 1, "as_of_date": as_of, "retrieved_at": datetime.now(timezone.utc).isoformat(), "results": {}, "errors": []}
    try:
        mapping = get_json("https://www.sec.gov/files/company_tickers.json")
        tickers = {r["ticker"].upper(): int(r["cik_str"]) for r in mapping.values()}
    except Exception as e:
        tickers = {}
        output["errors"].append(f"SEC ticker map unavailable: {type(e).__name__}")
    for symbol in symbols:
        cik = tickers.get(symbol.replace(".", "-")) or tickers.get(symbol)
        if not cik:
            output["results"][symbol] = {"symbol": symbol, "as_of_date": as_of, "status": "unavailable", "error": "SEC識別子未取得"}
            continue
        time.sleep(.3)
        try:
            facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
            output["results"][symbol] = normalize(facts, symbol, cik, as_of)
        except Exception as e:
            output["results"][symbol] = {"symbol": symbol, "as_of_date": as_of, "status": "unavailable", "error": f"SEC取得不可: {type(e).__name__}"}
    output["coverage"] = coverage(output["results"], len(ordered), len(symbols))
    (root / "book-financials.json").write_text(json.dumps(output, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"SEC evidence {as_of}: " + json.dumps(output["coverage"], ensure_ascii=False) + "; missing remains unknown", flush=True)

def coverage(results, eligible, requested):
    values = list(results.values())
    derived = lambda key: sum(any(p.get("derived") == DERIVED_Q4 for p in (r.get("quarterly") or {}).get(key, [])) for r in values)
    return {"eligible": eligible, "requested": requested,
        "available": sum(r.get("status") == "available" for r in values), "partial": sum(r.get("status") == "partial" for r in values),
        "unavailable": sum(r.get("status") == "unavailable" for r in values), "q4_revenue_derived": derived("revenue"), "q4_net_income_derived": derived("netIncome")}

if __name__ == "__main__":
    main()
