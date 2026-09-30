"""Restore only prior published observations; never reconstruct historical passes."""
import hashlib
import gzip
import json
from pathlib import Path
import re
from urllib.request import urlopen
from urllib.error import HTTPError

ROOT = Path('public/static-data')
BASE = 'https://kusennjp1-ai.github.io/screener/static-data/'

def main():
    try:
        with urlopen(BASE + 'candidate-history/index.json', timeout=30) as response:
            catalog = json.load(response)
    except HTTPError as error:
        if error.code == 404:
            print('First release: no published candidate history yet')
            return
        raise
    for ref in catalog['snapshots']:
        if not re.fullmatch(r'candidate-history/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?', ref['path']):
            raise ValueError('Unexpected history path')
        with urlopen(BASE + ref['path'], timeout=60) as response:
            raw = response.read()
        content = gzip.decompress(raw) if ref['path'].endswith('.gz') else raw
        if hashlib.sha256(raw).hexdigest() != ref['sha256'] or json.loads(content)['as_of'] != ref['as_of']:
            raise ValueError('Published history failed integrity validation')
        destination = ROOT / ref['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    (ROOT / 'candidate-history/index.json').write_text(json.dumps(catalog), encoding='utf-8')
    print(f"Restored {len(catalog['snapshots'])} published candidate snapshots")

if __name__ == '__main__':
    main()
