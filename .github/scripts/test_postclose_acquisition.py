"""Run the real acquisition date resolver and workflow script without DB/provider work."""
import ast
from contextlib import redirect_stdout
from datetime import date, datetime
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.market_calendar_service import MarketCalendarService


def resolve_at(now, market='US', **kwargs):
    # Load the production resolver alone: importing the CLI starts unrelated
    # SQL/provider wiring. Its real exchange calendar is deliberately not mocked.
    path = ROOT / 'backend/app/scripts/export_static_site.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_resolve_latest_completed_trading_date')
    service = MarketCalendarService()
    class Clock:
        def last_completed_trading_day(self, market, **options):
            return service.last_completed_trading_day(market, now=datetime.fromisoformat(now.replace('Z', '+00:00')), **options)
    namespace = {'date': date, 'get_market_calendar_service': Clock}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[function.name](market, **kwargs).isoformat()


class AcquisitionDateTests(unittest.TestCase):
    def test_actual_session_boundaries(self):
        for now, expected in [
            ('2026-10-27T20:01:00Z', '2026-10-26'),
            ('2026-10-27T20:01:59Z', '2026-10-26'),
            ('2026-10-27T20:02:00Z', '2026-10-27'),
            ('2026-10-28T20:02:00Z', '2026-10-28'),
            ('2026-11-02T21:01:00Z', '2026-10-30'),
            ('2026-11-02T21:02:00Z', '2026-11-02'),
            ('2026-03-09T20:01:00Z', '2026-03-06'),
            ('2026-03-09T20:02:00Z', '2026-03-09'),
            ('2026-11-27T18:01:00Z', '2026-11-25'),
            ('2026-11-27T18:02:00Z', '2026-11-27'),
            ('2026-11-26T23:00:00Z', '2026-11-25'),
            ('2026-10-31T23:00:00Z', '2026-10-30'),
            ('2026-12-25T23:00:00Z', '2026-12-24'),
        ]:
            with self.subTest(now=now):
                self.assertEqual(resolve_at(now), expected)

    def test_non_us_default_and_explicit_manual_buffer_unchanged(self):
        self.assertEqual(resolve_at('2026-10-27T08:02:00Z', 'HK'), '2026-10-26')
        self.assertEqual(resolve_at('2026-10-27T08:30:00Z', 'HK'), '2026-10-27')
        self.assertEqual(resolve_at('2026-10-27T20:02:00Z', close_buffer_minutes=5), '2026-10-26')
        self.assertEqual(resolve_at('2026-10-27T20:05:00Z', close_buffer_minutes=5), '2026-10-27')
        self.assertEqual(resolve_at('2026-10-27T20:02:00Z', 'us'), '2026-10-27')


def fallback_script():
    workflow = (ROOT / '.github/workflows/static-site.yml').read_text(encoding='utf-8')
    step = workflow.split('      - name: Download per-market fallback artifacts\n', 1)[1].split('      - name: Validate market artifacts', 1)[0]
    return textwrap.dedent(step.split("          python - <<'PY'\n", 1)[1].rsplit('\n          PY', 1)[0])


class FallbackTests(unittest.TestCase):
    def run_script(self, *, present=False, requested='[]', malformed=False, fail_download=False):
        with tempfile.TemporaryDirectory() as temp:
            current, fallback = Path(temp) / 'current', Path(temp) / 'fallback'
            if present:
                current.mkdir()
                payload = {'market': 'US', 'schema_version': 'static-site-v2', 'entry': {}}
                if malformed:
                    payload.pop('entry')
                (current / 'manifest.market.json').write_text(json.dumps(payload))
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                endpoint = args[-1]
                if 'actions/workflows/static-site.yml/runs' in endpoint:
                    result = [{'workflow_runs': [{'id': 999}, {'id': 222}, {'id': 111}]}]
                elif 'actions/runs/222/artifacts' in endpoint:
                    result = [{'artifacts': [{'name': name, 'expired': False} for name in ['static-market-diagnostics-US', 'static-market-HK', 'static-market-US']]}]
                elif 'actions/runs/111/artifacts' in endpoint:
                    result = [{'artifacts': [{'name': 'static-market-US', 'expired': False}]}]
                elif args[1:3] == ['run', 'download']:
                    self.assertEqual(args[args.index('--name') + 1], 'static-market-US')
                    if fail_download and args[3] == '222':
                        raise subprocess.CalledProcessError(7, args, stderr='temporary download failure')
                    destination = Path(args[args.index('--dir') + 1]); destination.mkdir(parents=True)
                    (destination / 'manifest.market.json').write_text(json.dumps({'market': 'US', 'schema_version': 'static-site-v2', 'entry': {}}))
                    result = {}
                else:
                    raise AssertionError(f'Unexpected API call: {args}')
                return subprocess.CompletedProcess(args, 0, json.dumps(result), '')
            script = fallback_script().replace('Path("/tmp/static-market-artifacts-current")', f'Path({str(current)!r})').replace('Path("/tmp/static-market-artifacts-fallback")', f'Path({str(fallback)!r})')
            with patch.dict('os.environ', {'REPOSITORY': 'kusennjp1-ai/screener', 'CURRENT_RUN_ID': '999', 'BRANCH_NAME': 'main', 'STATIC_SITE_MARKETS': 'US', 'REQUESTED_MARKETS': requested}), patch('subprocess.run', run), redirect_stdout(io.StringIO()):
                try:
                    exec(compile(script, 'workflow-fallback', 'exec'), {})
                except SystemExit as error:
                    self.assertEqual(error.code, 0)
            return calls

    def test_current_required_market_skips_all_api_work(self):
        self.assertEqual(self.run_script(present=True), [])

    def test_missing_market_downloads_only_exact_name_and_stops_after_found(self):
        calls = self.run_script()
        self.assertEqual(len(calls), 3)
        self.assertFalse(any('actions/runs/111/' in call[-1] for call in calls))

    def test_incomplete_current_metadata_does_not_suppress_fallback(self):
        self.assertEqual(len(self.run_script(present=True, malformed=True)), 3)

    def test_failed_download_can_recover_from_older_run(self):
        calls = self.run_script(fail_download=True)
        downloads = [call for call in calls if call[1:3] == ['run', 'download']]
        self.assertEqual([call[3] for call in downloads], ['222', '111'])


if __name__ == '__main__':
    unittest.main()
