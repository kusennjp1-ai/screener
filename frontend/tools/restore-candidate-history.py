"""Restore only prior published observations; never reconstruct historical passes."""
import hashlib
import io
from datetime import date
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


INDICATOR_VERSION = 'canonical-entry-observations-v1'


def indicator_references(catalog):
    if catalog.get('version') != INDICATOR_VERSION or not isinstance(catalog.get('snapshots'), list) or len(catalog['snapshots']) > 126:
        raise ValueError('Invalid published indicator catalog')
    references = {}
    for ref in catalog['snapshots']:
        day = ref.get('as_of', '')
        try:
            valid = date.fromisoformat(day).isoformat() == day
        except (ValueError, TypeError):
            valid = False
        if not valid or ref.get('version') != INDICATOR_VERSION or not re.fullmatch(r'indicator-history/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json\.gz', ref.get('path', '')) or not ref['path'].startswith('indicator-history/' + day + '-') or not re.fullmatch(r'[a-f0-9]{64}', ref.get('sha256', '')) or not ref['path'].endswith('-' + ref['sha256'][:16] + '.json.gz') or day in references:
            raise ValueError('Unexpected or duplicate indicator reference')
        references[day] = ref
    return references


def indicator_payload(ref, raw):
    if len(raw) > 64 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != ref['sha256']:
        raise ValueError('Published indicator failed integrity validation')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        content = compressed.read(128 * 1024 * 1024 + 1)
    if len(content) > 128 * 1024 * 1024:
        raise ValueError('Published indicator exceeds decoded limit')
    value = json.loads(content)
    if value.get('version') != INDICATOR_VERSION or value.get('as_of') != ref['as_of'] or not isinstance(value.get('records'), list):
        raise ValueError('Published indicator identity mismatch')
    return value


def restore_indicator_history():
    directory = ROOT / 'indicator-history'
    index = directory / 'index.json'
    existing = indicator_references(json.loads(index.read_bytes())) if index.exists() else {}
    try:
        with urlopen(BASE + 'indicator-history/index.json', timeout=30) as response:
            catalog_bytes = response.read(1024 * 1024 + 1)
    except HTTPError as error:
        if error.code != 404:
            raise
        if existing:
            raise ValueError('Published indicator catalog is missing; refusing to erase existing observations') from error
        directory.mkdir(parents=True, exist_ok=True)
        if not index.exists():
            index.write_text(json.dumps({'version': INDICATOR_VERSION, 'snapshots': []}), encoding='utf-8')
        print('First release: no published indicator observations yet')
        return
    if len(catalog_bytes) > 1024 * 1024:
        raise ValueError('Published indicator catalog exceeds limit')
    catalog = json.loads(catalog_bytes)
    remote = indicator_references(catalog)
    oldest = min(remote, default='')
    for day, previous in existing.items():
        if day in remote and previous != remote[day]:
            raise ValueError('Published indicator changed the first same-date observation')
        if day not in remote and not (len(remote) == 126 and day < oldest):
            raise ValueError('Published indicator catalog lost an existing observation')
    for day, ref in remote.items():
        destination = ROOT / ref['path']
        if day in existing and destination.exists():
            raw = destination.read_bytes()
        else:
            with urlopen(BASE + ref['path'], timeout=60) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
        indicator_payload(ref, raw)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            indicator_payload(ref, destination.read_bytes())
        else:
            destination.write_bytes(raw)
    directory.mkdir(parents=True, exist_ok=True)
    # Keep the published catalog's exact bytes, and expose it only after every
    # referenced immutable observation has passed hash/date/version validation.
    temporary = index.with_suffix('.tmp')
    temporary.write_bytes(catalog_bytes)
    temporary.replace(index)
    print(f"Restored {len(remote)} published indicator snapshots")


def main():
    restore_selection_history()
    restore_performance_history()
    restore_indicator_history()

if __name__ == '__main__':
    main()
