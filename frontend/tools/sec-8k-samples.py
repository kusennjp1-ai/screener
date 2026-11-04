"""Collect a few real 8-K earnings releases (Item 2.02, exhibit 99.1) for fiscal fourth
quarters whose EPS exists only as a 10-K annual value.

These documents are fixtures for a later, separately reviewed parser of GAAP diluted
three-month EPS. Nothing here is parsed into data or published: the files go to an
output directory outside public/ that CI keeps as a short-lived artifact. Requests use
the same User-Agent and shared rate limiter as sec-financials.py (at most 3 per symbol).
"""
import argparse
from datetime import date, datetime, timezone
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

_spec = importlib.util.spec_from_file_location("sec_financials", Path(__file__).with_name("sec-financials.py"))
sec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sec)

MAX_SAMPLES = 10
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
# A fiscal Q4 counts only while it is one of the latest four quarters.
MAX_FISCAL_YEAR_AGE_DAYS = 400
EXHIBIT_99_1 = re.compile(r"(?<![a-z])(?:d?ex|exhibit)[-_ ]?99[-_.]?0?1(?![0-9])", re.IGNORECASE)
DOCUMENT = re.compile(r"\.(?:htm|html|txt)$", re.IGNORECASE)


def read_book(root):
    for name in ("book-financials.json.gz", "book-financials.json"):
        path = Path(root) / name
        if path.exists():
            body = path.read_bytes()
            return json.loads(gzip.decompress(body) if name.endswith(".gz") else body)
    return None


def q4_eps_gaps(book, limit=MAX_SAMPLES):
    """Symbols whose latest fiscal year has an annual EPS but no reported fourth-quarter EPS."""
    as_of = book.get("as_of_date")
    out = []
    for symbol, record in (book.get("results") or {}).items():
        if len(out) >= limit:
            break
        if record.get("status") not in ("available", "partial") or not isinstance(record.get("cik"), int):
            continue
        annual = record.get("annualEps") or []
        if not annual:
            continue
        fiscal_year_end = annual[-1].get("end")
        reported = {p.get("end") for p in (record.get("quarterly") or {}).get("eps") or []}
        if not sec.valid_date(fiscal_year_end) or fiscal_year_end in reported:
            continue
        if (date.fromisoformat(as_of) - date.fromisoformat(fiscal_year_end)).days > MAX_FISCAL_YEAR_AGE_DAYS:
            continue
        out.append({"symbol": symbol, "cik": record["cik"], "fiscal_year_end": fiscal_year_end})
    return out


def earnings_release(submissions, fiscal_year_end, as_of):
    """The first Item 2.02 8-K filed on or after the fiscal year end (and by the as-of
    date): the release that reports that fiscal fourth quarter."""
    recent = (submissions.get("filings") or {}).get("recent") or {}
    rows = zip(recent.get("form") or [], recent.get("items") or [], recent.get("filingDate") or [], recent.get("accessionNumber") or [])
    found = [(filed, accession) for form, items, filed, accession in rows
             if form in ("8-K", "8-K/A") and "2.02" in [item.strip() for item in str(items or "").split(",")]
             and sec.valid_date(filed) and fiscal_year_end <= filed <= as_of and isinstance(accession, str) and accession]
    return min(found) if found else None


def exhibit_name(index):
    """The exhibit 99.1 document named in a filing's index.json, if one is identifiable."""
    names = [item.get("name") for item in ((index.get("directory") or {}).get("item") or []) if isinstance(item, dict)]
    matches = [name for name in names if isinstance(name, str) and DOCUMENT.search(name) and EXHIBIT_99_1.search(name)]
    return sorted(matches, key=len)[0] if matches else None


def get_bytes(url, opener=urlopen, limiter=None):
    limiter = limiter or sec.LIMITER
    req = Request(url, headers={"User-Agent": sec.user_agent(), "Accept-Encoding": "gzip"})
    limiter.wait()
    with opener(req, timeout=30) as response:
        raw = response.read(MAX_DOCUMENT_BYTES + 1)
        headers = getattr(response, "headers", None)
        if ((headers.get("Content-Encoding", "") if headers is not None else "") or "").strip().lower() == "gzip":
            raw = gzip.decompress(raw)
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise ValueError("document too large")
    return raw


def collect(gaps, as_of, output, get_json=None, get_document=None):
    get_json = get_json or sec.get_json
    get_document = get_document or get_bytes
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    samples = []
    for gap in gaps:
        cik, entry = gap["cik"], dict(gap, status="not_found")
        try:
            submissions = get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
            release = earnings_release(submissions, gap["fiscal_year_end"], as_of)
            if release:
                filed, accession = release
                folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}"
                entry.update(filed=filed, accession=accession, status="no_exhibit")
                name = exhibit_name(get_json(f"{folder}/index.json"))
                if name:
                    body = get_document(f"{folder}/{name}")
                    path = output / f"{gap['symbol']}-{accession}-{name}"
                    path.write_bytes(body)
                    entry.update(status="saved", url=f"{folder}/{name}", file=path.name, bytes=len(body), sha256=hashlib.sha256(body).hexdigest(),
                                 retrieved_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
        except Exception as error:
            entry.update(status="error", error=type(error).__name__)
        samples.append(entry)
    manifest = {"schema_version": 1, "as_of_date": as_of, "purpose": "fixtures for a fiscal-Q4 GAAP diluted EPS parser; not published",
                "samples": samples}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max", type=int, default=MAX_SAMPLES)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    book = read_book("public/static-data")
    if not book:
        print("8-K samples: no SEC evidence file", flush=True)
        return
    gaps = q4_eps_gaps(book, max(0, min(args.max, MAX_SAMPLES)))
    manifest = collect(gaps, book["as_of_date"], args.output)
    counts = {}
    for sample in manifest["samples"]:
        counts[sample["status"]] = counts.get(sample["status"], 0) + 1
    print("8-K earnings-release samples (not published): " + json.dumps({"requested": len(gaps), **counts}), flush=True)


if __name__ == "__main__":
    main()
