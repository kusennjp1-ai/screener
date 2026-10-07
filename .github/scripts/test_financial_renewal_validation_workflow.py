"""Local workflow contract checks. No GitHub or candidate archive is contacted."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/financial-renewal-actual-candidate-validation.yml'
BINDING = ROOT / '.github/scripts/financial-renewal-actual-candidate-binding.json'


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.w = yaml.safe_load(WORKFLOW.read_text())
        self.job = self.w['jobs']['validate']

    def test_only_isolated_push_and_read_permissions(self):
        events = self.w.get('on', self.w.get(True))
        self.assertEqual(events, {'push': {'branches': ['diagnostic/financial-renewal-actual-validation-20261007']}})
        self.assertEqual(self.w['permissions'], {'contents': 'read', 'actions': 'read'})
        self.assertEqual(self.job['timeout-minutes'], 60)
        self.assertFalse(self.w['concurrency']['cancel-in-progress'])

    def test_inline_binding_matches_wrapper_binding_exactly(self):
        self.assertEqual(json.loads(self.job['env']['REVIEWED_SOURCE_BINDING']), json.loads(BINDING.read_text()))

    def test_first_step_fails_before_any_checkout_when_unbound(self):
        first = self.job['steps'][0]
        self.assertIn('run', first)
        code = first['run'].split("python3 - <<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            unbound = json.loads(self.job['env']['REVIEWED_SOURCE_BINDING'])
            unbound['workflow_id'] = None
            env = dict(os.environ, RUNNER_TEMP=tmp, GITHUB_OUTPUT=str(Path(tmp) / 'output'),
                       REVIEWED_SOURCE_BINDING=json.dumps(unbound))
            result = subprocess.run(['python3', '-c', code], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Unbound workflow_id', result.stderr)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_exact_A_checkout_and_all_three_phases_are_supervised(self):
        steps = self.job['steps']
        checkouts = [step for step in steps if step.get('uses') == 'actions/checkout@v4']
        self.assertEqual(len(checkouts), 2)
        self.assertEqual(checkouts[1]['with']['ref'], json.loads(BINDING.read_text())['head_sha'])
        self.assertEqual(checkouts[1]['with']['fetch-depth'], 0)
        self.assertTrue(all(step['with']['persist-credentials'] is False for step in checkouts))
        for phase in ('setup', 'retrieval', 'verification'):
            found = [step for step in steps if '--phase '+phase in step.get('run', '')]
            self.assertEqual(len(found), 1)
            self.assertIn('exec python3 diagnostic/.github/scripts/financial-renewal-validation-supervisor.py', found[0]['run'])
            self.assertIn('--job-start "$RUNNER_TEMP/financial-renewal-validation-start.json"', found[0]['run'])
        self.assertEqual(self.job['env']['NODE_OPTIONS'], '--max-old-space-size=3072')

    def test_only_bounded_report_artifact_is_uploaded_even_on_failure(self):
        steps = self.job['steps']
        uploads = [step for step in steps if 'upload-artifact' in step.get('uses', '')]
        self.assertEqual(len(uploads), 1)
        upload = uploads[0]
        self.assertEqual(upload['if'], "always() && steps.binding.outputs.bound == 'true'")
        self.assertEqual(upload['with']['path'], '${{ runner.temp }}/financial-renewal-validation-reports/')
        self.assertEqual(upload['timeout-minutes'], 5)
        self.assertTrue(all('deploy' not in step.get('uses', '') for step in steps))


if __name__ == '__main__':
    unittest.main()
