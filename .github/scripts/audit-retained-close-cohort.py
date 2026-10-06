"""Read-only ZIP/TAR cohort replay; no bulk extraction or provider access."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', required=True, type=Path)
parser.add_argument('--sha256', required=True)
parser.add_argument('--prior-rows', required=True, type=Path)
parser.add_argument('--target-rows', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
with args.archive.open('rb') as handle:
    assert hashlib.file_digest(handle, 'sha256').hexdigest() == args.sha256, 'Archive digest mismatch'
prior = json.loads(args.prior_rows.read_text()); target = json.loads(args.target_rows.read_text())
def liquid(row):
    return (row.get('current_price') or 0) >= 10 and (row.get('adv_usd') or 0) >= 20_000_000
required = {row['symbol'] for row in prior['rows'] if liquid(row)} | {row['symbol'] for row in target['rows'] if liquid(row)}
rows = {row['symbol']: row for row in target['rows']}
assert len(rows) == len(target['rows']), 'Duplicate target identities'
assert required <= rows.keys(), 'Target dropped protected prior members'
paths = {'static-data/' + rows[s]['chart_path']: s for s in required if rows[s].get('chart_path')}
assert len(paths) == sum(bool(rows[s].get('chart_path')) for s in required), 'Conflicting chart references'
args.output.parent.mkdir(parents=True, exist_ok=True)
with args.output.open('w') as output:
    process = subprocess.Popen(['node', str(Path(__file__).with_suffix('.mjs'))], stdin=subprocess.PIPE, stdout=output, text=True)
    seen = set()
    def emit(symbol, chart):
        row = rows[symbol]
        process.stdin.write(json.dumps({'row': {'symbol': symbol, 'current_price': row.get('current_price')}, 'chart': chart, 'session': target['as_of_date']}) + '\n')
    with zipfile.ZipFile(args.archive) as archive:
        with archive.open('artifact.tar') as handle, tarfile.open(fileobj=handle, mode='r|') as tar:
            for member in tar:
                path = member.name.removeprefix('./')
                if path not in paths:
                    continue
                assert member.isfile() and not member.issym() and member.size < 128 * 1024 * 1024, 'Invalid chart entry'
                symbol = paths[path]
                assert symbol not in seen, 'Duplicate chart entry'
                emit(symbol, json.load(tar.extractfile(member))); seen.add(symbol)
    for symbol in sorted(required - seen):
        emit(symbol, None)
    process.stdin.close()
    assert process.wait() == 0, 'Independent chart verifier failed'
report = json.loads(args.output.read_text())
report.update(archive_sha256=args.sha256, session=target['as_of_date'],
              prior_rows_sha256=hashlib.sha256(args.prior_rows.read_bytes()).hexdigest(),
              target_rows_sha256=hashlib.sha256(args.target_rows.read_bytes()).hexdigest(),
              nontrading_exclusions=[], prior_published_rows_retained=len({row['symbol'] for row in prior['rows']} & rows.keys()))
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key:value for key,value in report.items() if key != 'results'}, indent=2))
