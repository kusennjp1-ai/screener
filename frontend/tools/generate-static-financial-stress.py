#!/usr/bin/env python3
"""Offline, synthetic PR69 producer-certified transport stress.

Input is a retained encoded or decoded research index, never an output destination.
No vendor requests or repository writes. Output is for tests, never publication.

Example:
  LITELLM_LOCAL_MODEL_COST_MAP=true python frontend/tools/generate-static-financial-stress.py \
    --repo /path/to/screener --input /tmp/static-financial-replay-rows.json \
    --output /tmp/static-financial-varied-stress-rows.json --variant varied

The fixed variant reproduces the original seven-proof-per-row stress. The varied
variant uses 20 quarterly calendars, 84 annual calendars, and four independent
quarterly/annual Basic/Diluted EPS metric combinations, all supported by v1.
"""
import argparse
import calendar
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
import subprocess
from pathlib import Path
import sys


def month_end_shift(period, months, days):
    original = date.fromisoformat(period)
    total = original.year * 12 + original.month - 1 + months
    year, month_index = divmod(total, 12)
    shifted = date(year, month_index + 1, calendar.monthrange(year, month_index + 1)[1])
    return (shifted + timedelta(days=days)).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--variant", choices=["legacy", "fixed", "varied"], default="varied")
    args = parser.parse_args()
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")
    sys.path.insert(0, str(args.repo.resolve() / "backend"))
    import pandas as pd
    from app.services.eps_rating_service import EPSRatingService
    from app.services.financial_source_capture import _statement_subset, statement_evidence
    from app.services.financial_source_evidence import FINANCIAL_FIELDS, make_capture_context, make_envelope
    from app.services.growth_cadence_service import compute_cadence_aware_growth
    from app.services.static_financial_evidence import build_static_financial_current

    source_bytes = args.input.read_bytes()
    data = json.loads(source_bytes)
    if data.get("schema") == "research-table-v1":
        decoder = args.repo.resolve() / "frontend/src/static/researchTransport.js"
        data = json.loads(subprocess.check_output([
            "node", "--input-type=module", "-e",
            "import {readFileSync} from 'node:fs'; import {pathToFileURL} from 'node:url'; const {decodeResearchIndex}=await import(pathToFileURL(process.argv[1])); process.stdout.write(JSON.stringify(decodeResearchIndex(JSON.parse(readFileSync(process.argv[2],'utf8')))));",
            str(decoder), str(args.input.resolve()),
        ], text=True))
    quarter_base = ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"]
    annual_base = ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"]
    now = "2026-10-03T16:35:00.000Z"
    available_counts, quarterly_calendars, annual_calendars, metrics = Counter(), set(), set(), Counter()

    for index, row in enumerate(data["rows"]):
        if args.variant == "legacy":
            row["financial_current"] = build_static_financial_current(row, now=now, as_of_date=data["as_of_date"], market=row.get("market"))
            available_counts[len(row["financial_current"]["p"])] += 1
            continue
        observed = datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(milliseconds=index * 1001)
        v = 1 + ((index * 7919) % 120000) / 10000
        if args.variant == "varied":
            quarter_months, quarter_days = (index // 5) % 4, index % 5 - 3
            annual_months, annual_days = (index // 7) % 12 - 8, index % 7 - 3
            qmetric = "Basic EPS" if index % 2 else "Diluted EPS"
            ametric = "Basic EPS" if (index // 2) % 2 else "Diluted EPS"
        else:
            quarter_months = quarter_days = annual_months = annual_days = 0
            qmetric = ametric = "Diluted EPS"
        quarter_periods = [month_end_shift(period, quarter_months, quarter_days) for period in quarter_base]
        annual_periods = [month_end_shift(period, annual_months, annual_days) for period in annual_base]
        quarterly = pd.DataFrame(
            [[v, 1.1 + v / 2, 2.1 + v / 3, 3.1 + v / 4, 1.2 + v / 5, -2 - v / 6],
             [100., 100., 120., 130., 110., 150.]],
            index=[qmetric, "Total Revenue"], columns=pd.to_datetime(quarter_periods),
        )
        annual = pd.DataFrame([[5 + v, 4 + v / 2, 3 + v / 3, 2 + v / 4, 1 + v / 5]],
                              index=[ametric], columns=pd.to_datetime(annual_periods))
        acquisitions = {}
        for attribute, frame in [("quarterly_income_stmt", quarterly), ("income_stmt", annual)]:
            subset = _statement_subset(frame)
            prefix = "annual" if attribute == "income_stmt" else "quarterly"
            subset["source_rows"] = {
                item["metric"].lower().replace(" ", ""): {
                    "provider_metric": prefix + item["metric"].replace(" ", ""),
                    "values": {pd.Timestamp(column).date().isoformat(): value
                               for column, value in zip(subset["columns"], item["values"])},
                    "currencies": ["USD"],
                } for item in subset["rows"]
            }
            acquisitions[attribute] = make_capture_context(
                symbol=row["symbol"], market="US", source="yfinance",
                producer=f"yfinance.{attribute}/transport-capture-v1", provider_symbol=row["symbol"],
                observed_at=observed, source_payload=subset, capture_id=attribute,
            )
        growth = compute_cadence_aware_growth(quarterly, market="US", include_source_context=True)
        eps = EPSRatingService().calculate_eps_rating_data(annual, quarterly, include_source_context=True)
        contexts = {**growth.pop("_financial_source_context"), **eps.pop("_financial_source_context")}
        made = {**growth, **eps, "symbol": row["symbol"], "market": "US",
                "annual_eps_growth_3y": [25., 33., 50.]}
        fields = statement_evidence(made, contexts, acquisitions)
        made["financial_source_evidence"] = make_envelope(symbol=row["symbol"], market="US", fields=fields)
        proof = build_static_financial_current(made, now=now, as_of_date=data["as_of_date"])
        if set(proof["p"]) != {"0", "1", "2", "3", "5", "6", "7"}:
            raise AssertionError(f"Expected all seven available proofs for {row['symbol']}: {proof['r']}")
        for field_index in proof["p"]:
            row[FINANCIAL_FIELDS[int(field_index)]] = made[FINANCIAL_FIELDS[int(field_index)]]
        row["financial_current"] = proof
        available_counts[len(proof["p"])] += 1
        quarterly_calendars.add(tuple(quarter_periods))
        annual_calendars.add(tuple(annual_periods))
        metrics[f"quarterly={qmetric};annual={ametric}"] += 1

    encoded = json.dumps(data, separators=(",", ":")).encode()
    args.output.write_bytes(encoded)
    report = {
        "synthetic_test_only": True, "no_vendor_requests": True, "variant": args.variant,
        "rows": len(data["rows"]), "available_proof_counts": dict(available_counts),
        "total_available_proofs": sum(count * rows for count, rows in available_counts.items()),
        "quarterly_calendars": len(quarterly_calendars), "annual_calendars": len(annual_calendars),
        "metric_combinations": dict(metrics), "evaluated_at": now, "as_of_date": data["as_of_date"],
        "quarter_latest_range": [min(p[0] for p in quarterly_calendars), max(p[0] for p in quarterly_calendars)] if quarterly_calendars else None,
        "annual_latest_range": [min(p[0] for p in annual_calendars), max(p[0] for p in annual_calendars)] if annual_calendars else None,
        "input_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "output_sha256": hashlib.sha256(encoded).hexdigest(),
        "qualification": "Actual PR69 arithmetic/capture constructors and strict static proof validator on synthetic source inputs; not live-source validation or a universal budget bound.",
    }
    args.output.with_suffix(".report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
