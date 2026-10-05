"""Destination-only reported annual EPS policy; original archive replay is unchanged.

Inputs must come from load_archive, which validates the original USD-only stored
producer projections. Never call this policy while verifying those old receipts.
"""
from copy import deepcopy
from pathlib import Path
import json

from . import financial_statement_batch as batch

CONTRACT_PATH = Path(__file__).resolve().parents[3] / 'contracts/native_annual_history_v1.json'
CONTRACT = json.loads(CONTRACT_PATH.read_text())


def extend_annual_history(symbol, item, acquisition, receipt, *, now, as_of):
    """Return a new current history, or None when the narrow extension cannot apply.

    Acquisitions retain the provider-reported per-share series. No split, ADR or
    unit factor is inferred. Exact USD histories use the legacy path unchanged.
    """
    history = item['financial_history']
    if (item.get('instrument_applicability', {}).get('status') != 'unverified'
            or history.get('annual')
            or item['history_source_diagnostics']['reasons'].get('annual') != 'unsupported_currency'
            or acquisition is None or receipt is None):
        return None
    _, context, reason = batch.validate_acquisition(acquisition['raw'], symbol, 'income_stmt', now=now, as_of=as_of)
    observed = batch.clock(context['observed_at'])
    if reason != 'current' or (now - observed).total_seconds() > CONTRACT['source_max_age_hours'] * 3600:
        return None
    expected_receipt = {'attribute': 'income_stmt', 'receipt_sha256': receipt['receipt_sha256'],
                        **{key: context[key] for key in ('capture_id', 'raw_payload_sha256', 'observed_at')}}
    if receipt != expected_receipt:
        raise ValueError('Native annual history receipt identity mismatch')
    source = context['source_payload']
    eps = source['source_rows'].get('dilutedeps')
    if not isinstance(eps, dict) or set(eps) != {'provider_metric', 'values', 'currencies'} or eps.get('provider_metric') != CONTRACT['provider_metric']:
        return None
    currencies = eps.get('currencies')
    if (not isinstance(currencies, list) or len(currencies) != 1
            or currencies[0] not in CONTRACT['supported_currencies'] or currencies[0] == 'USD'):
        return None
    periods = sorted(str(column)[:10] for column in source['columns'])
    selected = periods[-4:]
    if (len(selected) != 4 or len(set(periods)) != len(periods)
            or any(batch.day(period) > as_of for period in periods)
            or (as_of - batch.day(selected[-1])).days > CONTRACT['latest_period_max_age_days']
            or any(not batch.finite(eps['values'].get(period)) for period in selected)
            or any(not CONTRACT['period_gap_days'][0] <= (batch.day(end) - batch.day(start)).days <= CONTRACT['period_gap_days'][1]
                   for start, end in zip(selected, selected[1:]))):
        return None
    currency = currencies[0]
    result = deepcopy(history)
    result.update(schema_version=CONTRACT['history_schema'], currency=currency, annual_currency=currency,
                  quarterly_currency='USD', quarterly_retrieved_at=history['retrieved_at'] if history.get('quarterly') else None, status='available',
                  annual=[{'end': period, 'eps': eps['values'].get(period), 'revenue': None, 'netIncome': None} for period in periods],
                  annual_source={'symbol': symbol, 'metric': CONTRACT['provider_metric'], 'currency': currency,
                                 'unit': CONTRACT['unit'], 'share_basis': CONTRACT['share_basis'], **expected_receipt})
    # The oldest included original receipt still owns the whole history TTL.
    clocks = [observed]
    if history.get('quarterly'):
        clocks.append(batch.clock(history['retrieved_at']))
    result['retrieved_at'] = batch.timestamp(min(clocks))
    return result
