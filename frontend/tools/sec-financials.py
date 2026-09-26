"""Point-in-time SEC evidence for candidates. Missing facts remain unknown."""
import argparse
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import time
from urllib.request import Request, urlopen

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

def normalize(facts, symbol, cik, as_of):
    if not valid_date(as_of) or facts.get("cik") != cik:
        raise ValueError("CIK or as-of mismatch")
    fields = {key: series(facts, key, as_of) for key in TAGS}
    return {"schema_version": 1, "symbol": symbol, "cik": cik, "as_of_date": as_of,
        "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
        "status": "available" if fields["eps"] and fields["revenue"] else "partial",
        "quarterly": fields, "annualEps": series(facts, "eps", as_of, annual=True),
        "limitations": ["US GAAP標準タグ・USDの報告値。調整後EPSと同一ではない", "直接報告された四半期だけを使用。年間EPSからQ4を差し引き推計しない", "提出日までの情報。同日中の発表時刻・決算発表日そのものは未確認", "一時利益・予想値・修正履歴・企業材料は未検証"]}

def get_json(url):
    req = Request(url, headers={"User-Agent": "screener-research https://github.com/kusennjp1-ai/screener", "Accept": "application/json"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=60)
    args = parser.parse_args()
    root = Path("public/static-data")
    daily = json.loads(Path("public/research-daily.json").read_text(encoding="utf-8"))
    as_of = daily["as_of_date"]
    symbols = list(dict.fromkeys(r["symbol"] for method in ("minervini2", "minervini", "ibd") for r in daily["candidates"].get(method, [])))[:max(0, min(args.limit, 100))]
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
    (root / "book-financials.json").write_text(json.dumps(output, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    count = sum(r.get("status") == "available" for r in output["results"].values())
    print(f"SEC evidence {as_of}: {count}/{len(symbols)} available; missing remains unknown")

if __name__ == "__main__":
    main()
