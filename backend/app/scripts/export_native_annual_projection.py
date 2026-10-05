"""Emit a separately versioned current native annual projection from an old replay.

This opt-in destination layer never alters certifier runtime, source receipts,
old projections or snapshots. It grants no source-certification authority and is
not wired to the publication controller.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from app.scripts import export_statement_projection as legacy
from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.native_annual_history import CONTRACT, CONTRACT_PATH, extend_annual_history

DERIVATION_SCHEMA = 'native-annual-destination-derivation-v1'
PROJECTOR_FILES = ('backend/app/scripts/export_native_annual_projection.py',
                   'backend/app/services/native_annual_history.py',
                   'contracts/native_annual_history_v1.json')


def derive_projection(original, verified, *, original_sha256, now):
    """Derive from the exact legacy destination output and verified original archive."""
    archive._sha(original_sha256)
    if (batch.digest_bytes(legacy.canonical_bytes(original)) != original_sha256
            or original['policy']['id'] != CONTRACT['source_policy_id']
            or original['bindings']['archive_manifest_sha256'] != verified.sha256
            or original['receipt_inventory_sha256'] != legacy.content_digest(original['receipt_inventory'])
            or batch.clock(original['financial_evaluated_at']) != now):
        raise ValueError('Native annual derivation source binding mismatch')
    result = deepcopy(original)
    hashes = {path: batch.digest_bytes((legacy.ROOT / path).read_bytes()) for path in PROJECTOR_FILES}
    result['policy'] = {'id': CONTRACT['policy_id'], 'contract_sha256': batch.digest_bytes(CONTRACT_PATH.read_bytes()),
                        'projector_sha256': legacy.content_digest({'files': hashes, 'legacy_policy': original['policy']})}
    result['derivation'] = {'schema_version': DERIVATION_SCHEMA, 'source_projection_sha256': original_sha256,
                            'source_policy': deepcopy(original['policy']),
                            'source_receipt_inventory_sha256': original['receipt_inventory_sha256']}
    for symbol, item in result['symbols'].items():
        sha = verified.manifest['current'].get(f'{symbol}/income_stmt')
        acquisition = verified.acquisitions.get(sha)
        receipt = next((entry for entry in item['source_receipts'] if entry['attribute'] == 'income_stmt'), None)
        if receipt is not None and receipt['receipt_sha256'] != sha:
            raise ValueError('Native annual derivation archive receipt mismatch')
        history = extend_annual_history(symbol, item, acquisition, receipt, now=now, as_of=batch.day(item['as_of_date']))
        if history is None:
            continue
        item['financial_history'] = history
        reason = ('nonpositive_comparison_base' if any(point['eps'] <= 0 for point in history['annual'][-4:-1]) else 'available')
        item['history_source_diagnostics']['reasons']['annual'] = reason
        item['history_source_diagnostics']['original_receipts'].append({key: receipt[key] for key in ('attribute', 'capture_id', 'observed_at', 'raw_payload_sha256')})
        item['source_diagnostics']['annual_history'] = reason
    result['financial_generation'] = legacy.financial_generation(result)
    return result


def export_projection(**kwargs):
    # First write the exact original-policy projection, then a new immutable file.
    summary = legacy.export_projection(**kwargs)
    original = json.loads(Path(summary['projection_path']).read_bytes())
    now = batch.clock(kwargs['evaluated_at'])
    base = Path(kwargs['base_path']).read_bytes()
    cohort = json.loads(Path(kwargs['cohort_path']).read_bytes())
    verified = archive.load_archive(kwargs['archive_dir'], kwargs['archive_sha256'], base_bytes=base, cohort=cohort, now=now)
    result = derive_projection(original, verified, original_sha256=summary['projection_sha256'], now=now)
    content = legacy.canonical_bytes(result)
    if len(content) > legacy.MAX_PROJECTION_BYTES:
        raise ValueError('Native annual projection exceeds bounded output size')
    sha = batch.digest_bytes(content)
    output = archive._safe(kwargs['output_dir']) / f'native-annual-projection-{sha}.json'
    archive._write_immutable(output, content)
    return {'projection_path': str(output), 'projection_sha256': sha,
            'financial_generation': result['financial_generation'],
            'receipt_inventory_sha256': result['receipt_inventory_sha256'],
            'symbol_count': len(result['symbols']), 'source_projection_path': summary['projection_path'],
            'source_projection_sha256': summary['projection_sha256'],
            'native_annual_histories': sum(item['financial_history'].get('schema_version') == CONTRACT['history_schema'] for item in result['symbols'].values())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('archive', 'archive-sha256', 'base', 'cohort', 'cohort-sha256', 'target-base',
                 'target-base-sha256', 'target-publication-identity', 'evaluated-at', 'output-dir'):
        parser.add_argument(f'--{flag}', required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(export_projection(archive_dir=args.archive, archive_sha256=args.archive_sha256,
            base_path=args.base, cohort_path=args.cohort, cohort_sha256=args.cohort_sha256,
            target_base_path=args.target_base, target_base_sha256=args.target_base_sha256,
            target_publication_identity=args.target_publication_identity, evaluated_at=args.evaluated_at,
            output_dir=args.output_dir), sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f'Native annual projection rejected: {exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
