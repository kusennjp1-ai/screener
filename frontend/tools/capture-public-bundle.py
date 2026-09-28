"""Reproducible local audit snapshot of the public application data."""
from concurrent.futures import ThreadPoolExecutor
import gzip
import json
from pathlib import Path
import requests
import time

ROOT = Path('public/static-data')
BASE = 'https://kusennjp1-ai.github.io/screener/static-data/'
BACKUP = Path('../.git/audit-before')
BACKUP.mkdir(parents=True, exist_ok=True)


def fetch(path):
    response = requests.get(BASE + path, timeout=45)
    response.raise_for_status()
    file = ROOT / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(response.content)
    return response.json()


manifest = fetch('manifest.json')
market = manifest['markets']['US']
scan = fetch(market['pages']['scan']['path'])
chunks = [c['path'] for c in scan['chunks']]
with ThreadPoolExecutor(max_workers=6) as pool:
    payloads = list(pool.map(fetch, chunks))
index = fetch(market['assets']['charts']['path'])
research = fetch(market['assets']['research']['path'])
rows = scan['initial_rows'] + [r for p in payloads for r in p['rows']]
(BACKUP/'rows.json').write_text(json.dumps(rows), encoding='utf-8')
stats = {}
for key, paths in [('scan', [market['pages']['scan']['path'], *chunks]), ('chart_index', [market['assets']['charts']['path']])]:
    bodies = [(ROOT/p).read_bytes() for p in paths]
    stats[key] = {'raw': sum(map(len,bodies)), 'gzip': sum(len(gzip.compress(b)) for b in bodies)}
(BACKUP/'sizes.json').write_text(json.dumps(stats), encoding='utf-8')
print('Baseline sizes', stats, flush=True)
symbols = {r['symbol'] for r in rows}
paths = [e['path'] for e in index['symbols'] if e['symbol'] in symbols]
with ThreadPoolExecutor(max_workers=8) as pool:
    for i, _ in enumerate(pool.map(fetch, paths)):
        if i % 500 == 0: print('Public charts', i, '/', len(paths), flush=True)
for path in ['book-benchmark.json','financial-history.json','book-financials.json','entry-context.json', market['pages']['breadth']['path']]:
    try: fetch(path)
    except Exception as error: print(path, type(error).__name__)
print('Public snapshot ready', flush=True)
