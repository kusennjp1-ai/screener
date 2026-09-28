"""Update SEC 13F evidence and map securities using the public OpenFIGI API.

The checked-in seed contains only public aggregate counts and accession evidence,
so a denied SEC download does not destroy the last known reporting period.
"""
import argparse
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from institutional_holdings import aggregate_archives

REPO = Path(__file__).resolve().parents[2]
SEED = REPO / "data/institutional/sec13f.json.gz"
MAPPING = REPO / "data/institutional/openfigi.json"
CACHE = REPO / '.cache/sec13f'
ROOT = REPO / "frontend/public/static-data"
INDEX = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets"
UA = os.environ.get('SEC_USER_AGENT') or "ScreenerResearch https://github.com/kusennjp1-ai/screener"


def get(url):
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=60) as response:
        return response.read()


def refresh_archive(url, path):
    metadata_path = path.with_suffix('.http.json')
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    headers = {'User-Agent': UA}
    if path.exists():
        if metadata.get('etag'): headers['If-None-Match'] = metadata['etag']
        if metadata.get('last_modified'): headers['If-Modified-Since'] = metadata['last_modified']
    try:
        with urlopen(Request(url, headers=headers), timeout=120) as response:
            content=response.read()
            temporary=path.with_suffix('.tmp');temporary.write_bytes(content);temporary.replace(path)
            metadata_path.write_text(json.dumps({'etag':response.headers.get('ETag'),'last_modified':response.headers.get('Last-Modified')}))
    except HTTPError as error:
        if error.code != 304 or not path.exists(): raise


def map_securities(securities, cache, limit):
    pending = [c for c in securities if c not in cache or (cache[c].get('symbol') is None and cache[c].get('version',0) < (3 if c[0].isalpha() else 2))]
    universe_names = set()
    try:
        manifest = json.loads((ROOT / 'manifest.json').read_text(encoding="utf-8"))
        market = manifest['markets']['US']
        scan = json.loads((ROOT / market['pages']['scan']['path']).read_text(encoding="utf-8"))
        rows = scan['initial_rows']
        for chunk in scan['chunks']:
            rows += json.loads((ROOT / chunk['path']).read_text(encoding="utf-8"))['rows']
        universe_names = {re.sub('[^A-Z0-9]', '', r.get('company_name', '').upper())[:7] for r in rows}
    except (OSError, KeyError):
        pass
    # Common equity first; mapping still requires an exact US equity response.
    def priority(c):
        name = re.sub('[^A-Z0-9]', '', securities[c]['name'].upper())
        preferred = name.startswith(('ADVANCEDMICRO', 'TAIWANSEMICON', 'JPMORGANCHASE', 'KLACORP', 'KLATENCOR', 'SILICONLABOR'))
        # Names only prioritize requests; they NEVER establish ticker identity.
        reported_count=max((o['manager_count'] for o in securities[c]['observations']),default=0)
        return (not preferred, -reported_count, name[:7] not in universe_names,
                not any(x in securities[c]['class'].upper() for x in ('COM','ORD','ADR')), c)
    pending.sort(key=priority)
    for start in range(0, min(len(pending), limit), 10):
        request_started=time.monotonic()
        batch = pending[start:min(start+10,limit)]
        # International CINS identifiers (alphabetic first character) occupy
        # the SEC CUSIP column but use a different OpenFIGI identifier namespace.
        jobs = [{"idType": "ID_CINS" if c[0].isalpha() else "ID_CUSIP", "idValue": c, "exchCode": "US", "marketSecDes": "Equity"} for c in batch]
        request = Request("https://api.openfigi.com/v3/mapping", data=json.dumps(jobs).encode(), headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=30) as response:
                values = json.load(response)
            if len(values) != len(batch):
                raise ValueError("OpenFIGI response length mismatch")
            for cusip, value in zip(batch, values):
                matches = [r for r in value.get("data", []) if r.get("exchCode") == "US" and (r.get("securityType") in ("Common Stock", "Depositary Receipt", "REIT", "ADR") or r.get('securityType2') in ('Common Stock','Depositary Receipt'))]
                tickers = {r["ticker"].replace("/", "-").replace(".", "-") for r in matches}
                cache[cusip] = {"symbol": next(iter(tickers)) if len(tickers) == 1 else None,
                                "source": "OpenFIGI", 'version':3,"retrieved_at": datetime.now(timezone.utc).isoformat()}
        except HTTPError as error:
            if error.code == 429:
                time.sleep(min(60, max(3, int(error.headers.get("ratelimit-reset", 60)))))
            else:
                print(f"OpenFIGI HTTP {error.code}; unresolved mappings remain unknown", flush=True)
                break
        except Exception as error:
            print(f"OpenFIGI unavailable: {type(error).__name__}", flush=True)
            break
        if start % 100 == 0:
            print(f"OpenFIGI mapped {len(cache)} / {len(securities)} securities", flush=True)
        yield cache
        time.sleep(max(0,2.5-(time.monotonic()-request_started)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archives", nargs="*")
    parser.add_argument("--cutoff")
    parser.add_argument("--periods", nargs="*")
    parser.add_argument("--mapping-limit", type=int, default=200)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    seed = json.loads(gzip.decompress(SEED.read_bytes())) if SEED.exists() else {"mapping": {}, "securities": {}}
    cached_seed = CACHE / 'aggregate.json.gz'
    if cached_seed.exists():
        candidate = json.loads(gzip.decompress(cached_seed.read_bytes()))
        if candidate.get('publication_cutoff','') > seed.get('publication_cutoff',''): seed = candidate
    cached_mapping = CACHE / 'mapping.json'
    if cached_mapping.exists(): seed['mapping'].update(json.loads(cached_mapping.read_text(encoding='utf-8')))
    if MAPPING.exists():
        seed['mapping'].update(json.loads(MAPPING.read_text(encoding='utf-8')))
    refresh = {"checked_at": datetime.now(timezone.utc).isoformat(), "status": "cached"}
    archives = args.archives
    if args.refresh and not archives:
        try:
            html = get(INDEX).decode()
            links = re.findall(r'href="([^"]+form13f\.zip)"', html)
            cache_dir = CACHE
            cache_dir.mkdir(parents=True, exist_ok=True)
            downloaded = []
            for link in links[:2]:
                url = "https://www.sec.gov" + link if link.startswith("/") else link
                path = cache_dir / url.rsplit("/", 1)[-1]
                refresh_archive(url, path)
                downloaded.append(str(path))
            if len(downloaded) == 2:
                archives = downloaded
                # Distribution windows end Feb/May/Aug/Nov, reporting quarters
                # are read from filings (never inferred from ZIP publication).
                args.cutoff = datetime.strptime(Path(archives[0]).stem.split("_")[0].split("-")[1], "%d%b%Y").date().isoformat()
                from institutional_holdings import table, iso
                import zipfile
                counts = {}
                for path in archives:
                    with zipfile.ZipFile(path) as archive:
                        for row in table(archive, "SUBMISSION"):
                            period = iso(row.get("PERIODOFREPORT"))
                            if period and period <= args.cutoff:
                                counts[period] = counts.get(period, 0) + 1
                args.periods = sorted(sorted(counts, key=counts.get, reverse=True)[:2])
            if len(downloaded) != 2: raise ValueError('Two SEC distribution archives were not found')
            refresh["status"] = "downloaded"
        except Exception as error:
            refresh = {**refresh, "status": "unavailable", "reason": f"{type(error).__name__}: {error}"}
    if archives:
        if not args.cutoff or not args.periods or len(args.periods) != 2:
            raise ValueError("Two reporting periods and publication cutoff are required")
        aggregate = aggregate_archives(archives, args.cutoff, args.periods)
        seed = {**aggregate, "mapping": seed.get("mapping", {}),
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "archives": [{"file": Path(p).name, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in archives]}
        SEED.parent.mkdir(parents=True, exist_ok=True)
        SEED.write_bytes(gzip.compress(json.dumps(seed, separators=(",", ":")).encode(), mtime=0))
        cached_seed.write_bytes(SEED.read_bytes())
    for mapping in map_securities(seed["securities"], seed["mapping"], args.mapping_limit):
        seed["mapping"] = mapping
        temporary=MAPPING.with_suffix('.tmp')
        temporary.write_text(json.dumps(mapping, separators=(',',':')), encoding='utf-8')
        temporary.replace(MAPPING)
    cached_mapping.write_text(json.dumps(seed['mapping'],separators=(',',':')),encoding='utf-8')
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    as_of = (manifest.get("markets", {}).get("US") or manifest)["as_of_date"]
    by_symbol = {}
    for cusip, value in seed["securities"].items():
        symbol = seed["mapping"].get(cusip, {}).get("symbol")
        if symbol:
            by_symbol.setdefault(symbol, []).append((cusip, value))
    results = {}
    for symbol, entries in by_symbol.items():
        if len(entries) != 1:
            continue  # Corporate actions / class ambiguity require review.
        cusip, value = entries[0]
        observations = value["observations"]
        status = "available" if len(observations) == 2 and seed["publication_cutoff"] <= as_of and (date.fromisoformat(as_of) - date.fromisoformat(observations[-1]["period"])).days <= 180 else "incomplete"
        results[symbol] = {"symbol": symbol, "cusip": cusip, "status": status, "unit": "13f_reporting_manager_cik",
                           "source": "SEC Form 13F / OpenFIGI", "source_url": INDEX,
                           "publication_cutoff": seed["publication_cutoff"], "retrieved_at": seed["retrieved_at"], "refresh":refresh,
                           "observations": [{k:v for k,v in observation.items() if k!='filings'} for observation in observations],
                           "manager_delta": observations[-1]["manager_count"] - observations[0]["manager_count"] if len(observations) == 2 else None,
                           "scope": "公開13F報告運用会社（CIK単位）。ファンド数・親会社グループ数ではありません。非報告・非公開保有と集計期限後の提出は含みません。"}
    output = {"as_of_date": as_of, "refresh": refresh, "publication_cutoff": seed.get("publication_cutoff"), "results": results}
    (ROOT / "institutional-holdings.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"SEC institutional evidence: {len(results)} mapped securities, cutoff {seed.get('publication_cutoff')}", flush=True)


if __name__ == "__main__":
    main()
