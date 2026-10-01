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

def restore_selection_history():
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


def performance_references(catalog):
    if catalog.get('schema_version') != 1 or not isinstance(catalog.get('cohorts'), list):
        raise ValueError('Invalid published performance catalog')
    references = {}
    for ref in catalog['cohorts']:
        if not re.fullmatch(r'candidate-performance-history/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}-[a-f0-9]{16}\.json\.gz', ref.get('path', '')) or not re.fullmatch(r'[a-f0-9]{64}', ref.get('cohort_sha256', '')) or ref['cohort_sha256'] in references:
            raise ValueError('Unexpected or duplicate performance path')
        references[ref['cohort_sha256']] = ref
    return references


def performance_payload(ref, raw):
    if hashlib.sha256(raw).hexdigest() != ref.get('sha256'):
        raise ValueError('Published performance failed integrity validation')
    value = json.loads(gzip.decompress(raw))
    if value.get('schema_version') != 1 or value.get('calculator_version') != 'published-close-returns-v1' or value.get('cohort', {}).get('sha256') != ref['cohort_sha256'] or value.get('cohort', {}).get('as_of') != ref.get('as_of') or not isinstance(value.get('observations'), list) or not value['observations']:
        raise ValueError('Published performance identity mismatch')
    observations = {}
    for observation in value['observations']:
        if not isinstance(observation.get('symbol'), str) or not observation['symbol'] or observation.get('horizon') not in (5, 20, 60):
            raise ValueError('Invalid performance observation identity')
        key = (observation['symbol'], observation['horizon'])
        if key in observations:
            raise ValueError('Duplicate performance observation identity')
        observations[key] = observation
    if ref.get('observations') != len(observations):
        raise ValueError('Performance observation count mismatch')
    return value, observations


def restore_performance_history():
    directory = ROOT / 'candidate-performance-history'
    index = directory / 'index.json'
    # A successful Pages artifact may already contain mature observations.
    # A missing/regressed website must never erase that verified history.
    existing = performance_references(json.loads(index.read_text(encoding='utf-8'))) if index.exists() else {}
    try:
        with urlopen(BASE + 'candidate-performance-history/index.json', timeout=30) as response:
            catalog = json.load(response)
    except HTTPError as error:
        if error.code != 404:
            raise
        if existing:
            raise ValueError('Published performance catalog is missing; refusing to erase existing completed observations') from error
        directory.mkdir(parents=True, exist_ok=True)
        index.write_text(json.dumps({'schema_version': 1, 'cohorts': []}), encoding='utf-8')
        print('No published completed performance observations yet')
        return
    remote = performance_references(catalog)
    if not existing.keys() <= remote.keys():
        raise ValueError('Published performance catalog lost an existing cohort')
    for cohort, ref in remote.items():
        previous_ref = existing.get(cohort)
        previous_raw = (ROOT / previous_ref['path']).read_bytes() if previous_ref else None
        previous, previous_observations = performance_payload(previous_ref, previous_raw) if previous_ref else (None, {})
        if previous_ref and previous_ref['sha256'] == ref['sha256']:
            raw = previous_raw
        else:
            with urlopen(BASE + ref['path'], timeout=60) as response:
                raw = response.read()
        value, observations = performance_payload(ref, raw)
        if previous and value['cohort'] != previous['cohort']:
            raise ValueError('Published performance changed an existing cohort identity')
        if not previous_observations.keys() <= observations.keys():
            raise ValueError('Published performance lost an existing completed observation')
        if any(observations[key] != observation for key, observation in previous_observations.items()):
            raise ValueError('Published performance changed an existing completed observation')
        destination = ROOT / ref['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    directory.mkdir(parents=True, exist_ok=True)
    # The export stage replays the original price/SPY interval and verifies
    # maturity, completed-session provenance and each result before admission.
    index.write_text(json.dumps(catalog), encoding='utf-8')
    print(f"Restored completed observations for {len(catalog['cohorts'])} published cohorts")


def main():
    restore_selection_history()
    restore_performance_history()

if __name__ == '__main__':
    main()
