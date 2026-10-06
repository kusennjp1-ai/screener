"""Exercise the actual workflow admission expression for non-producing paths."""
from pathlib import Path
import re
import unittest
import yaml


class WorkflowPromotionPathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[3]
        cls.workflow = yaml.safe_load((root / '.github/workflows/static-site.yml').read_text())

    def admits(self, *, candidate_produced, candidate_id, downstream_id='2002', mode='full'):
        # Evaluate this narrowly allowlisted boolean expression from YAML, not
        # a second copy of the production condition or GitHub expressions.
        expression = self.workflow['jobs']['promote-daily-source']['if'].removeprefix('${{').removesuffix('}}').strip()
        values = {
            'needs.select-markets.outputs.source_promotion': 'true',
            'needs.select-markets.outputs.mode': mode,
            'needs.build-market.result': 'success',
            'needs.build-market.outputs.produced_candidate': candidate_produced,
            'needs.build-market.outputs.source_candidate_id': candidate_id,
            'needs.combine-and-build.result': 'success',
            'needs.combine-and-build.outputs.downstream_artifact_id': downstream_id,
        }
        expression = expression.replace("contains(fromJSON(needs.select-markets.outputs.markets), 'US')", 'True')
        for key, value in sorted(values.items(), key=lambda item: -len(item[0])):
            expression = expression.replace(key, repr(value))
        expression = expression.replace('&&', ' and ')
        if not re.fullmatch(r"[a-zA-Z0-9_ '!=().]+", expression):
            raise AssertionError('New workflow expression requires explicit test support')
        return eval(expression, {'__builtins__': {}}, {})

    def test_exit78_and_exit79_success_without_artifact_skip_promotion(self):
        for exit_code in (78, 79):
            with self.subTest(exit_code=exit_code):
                self.assertFalse(self.admits(candidate_produced='', candidate_id=''))
                self.assertFalse(self.admits(candidate_produced='false', candidate_id=''))

    def test_full_real_artifact_admitted_fast_and_missing_downstream_rejected(self):
        self.assertTrue(self.admits(candidate_produced='true', candidate_id='1001'))
        self.assertFalse(self.admits(candidate_produced='true', candidate_id='1001', mode='prices_only'))
        self.assertFalse(self.admits(candidate_produced='true', candidate_id='1001', downstream_id=''))

    def test_downloads_use_immutable_producer_ids_not_consumer_attempt_names(self):
        steps = self.workflow['jobs']['promote-daily-source']['steps']
        downloads = [step['with'] for step in steps if step.get('uses') == 'actions/download-artifact@v4']
        self.assertEqual(len(downloads), 2)
        for config in downloads:
            self.assertNotIn('name', config)
            self.assertNotIn('github.run_attempt', config['artifact-ids'])
            self.assertIn('needs.', config['artifact-ids'])

    def test_promotion_controller_binding_comes_from_current_workflow_context(self):
        steps = self.workflow['jobs']['promote-daily-source']['steps']
        publishers = [step['run'] for step in steps if 'stage_daily_price_source publish' in step.get('run', '')]
        self.assertEqual(len(publishers), 1)
        self.assertIn('--controller-sha "$GITHUB_SHA" --controller-ref "$GITHUB_REF"', publishers[0])
        self.assertNotIn('--controller-sha "${{ needs.', publishers[0])


if __name__ == '__main__':
    unittest.main()
