"""Exercise the actual workflow admission expression for non-producing paths."""
import ast
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


class WorkflowSchedulingPathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[3]
        cls.workflow = yaml.safe_load((root / '.github/workflows/static-site.yml').read_text())

    def evaluate(self, expression, *, event='schedule', ref='refs/heads/main',
                 default_branch='main', schedule='', prices_only='',
                 workflow_run_head_sha='', select_result='success', repair='',
                 cancelled=False, build_result='success', job_condition=False):
        # Evaluate the YAML's expression, with a deliberately small allowlist.
        # Model GitHub's implicit success() too, so removing every explicit
        # status function cannot accidentally pass the failure/skip cases.
        expression = expression.removeprefix('${{').removesuffix('}}').strip()
        if job_condition and not re.search(r'\b(always|cancelled|success|failure)\s*\(', expression):
            expression = f'success() && ({expression})'
        values = {
            'github.event_name': event,
            'github.ref': ref,
            'github.event.repository.default_branch': default_branch,
            'github.event.schedule': schedule,
            'github.event.inputs.prices_only': prices_only,
            'github.event.workflow_run.head_sha': workflow_run_head_sha,
            'needs.select-markets.result': select_result,
            'needs.select-markets.outputs.repair': repair,
            'needs.build-market.result': build_result,
        }
        for key, value in sorted(values.items(), key=lambda item: -len(item[0])):
            expression = expression.replace(key, repr(value))
        expression = expression.replace('&&', ' and ').replace('||', ' or ')
        expression = re.sub(r'!(?!=)', ' not ', expression).strip()
        functions = {
            'contains': lambda text, item: item.lower() in text.lower(),
            'format': lambda template, *args: template.format(*args),
            'always': lambda: True,
            'cancelled': lambda: cancelled,
            'success': lambda: build_result == 'success' and not cancelled,
            'failure': lambda: build_result == 'failure',
        }
        tree = ast.parse(expression, mode='eval')
        allowed = (ast.Expression, ast.BoolOp, ast.UnaryOp, ast.Compare,
                   ast.Constant, ast.And, ast.Or, ast.Not, ast.Eq, ast.NotEq,
                   ast.Call, ast.Name, ast.Load)
        for node in ast.walk(tree):
            if not isinstance(node, allowed) or isinstance(node, ast.Name) and node.id not in functions:
                raise AssertionError('New workflow expression requires explicit test support')
        return eval(compile(tree, '<workflow expression>', 'eval'), {'__builtins__': {}}, functions)

    def group(self, **context):
        return re.sub(r'\$\{\{(.*?)\}\}',
                      lambda match: str(self.evaluate(match.group(1), **context)),
                      self.workflow['concurrency']['group'])

    def test_full_and_fast_schedules_preserve_active_work_in_separate_groups(self):
        schedules = {
            '10 16 * * 1-6': 'static-site-refs/heads/main',
            '30 23 * * 1-6': 'static-site-refs/heads/main',
            '4 16 * * 1-5': 'static-site-refs/heads/main-fast',
            '31 16 * * 1-5': 'static-site-refs/heads/main-fast',
            '58 16 * * 1-5': 'static-site-refs/heads/main-fast',
        }
        for schedule, expected in schedules.items():
            with self.subTest(schedule=schedule):
                self.assertEqual(self.group(schedule=schedule), expected)
                self.assertIs(self.workflow['concurrency']['cancel-in-progress'], False)

    def test_manual_runs_keep_mode_and_branch_group_boundaries(self):
        for ref in ('refs/heads/main', 'refs/heads/topic'):
            for prices_only in ('', 'false', 'true'):
                with self.subTest(ref=ref, prices_only=prices_only):
                    suffix = '-fast' if prices_only == 'true' else ''
                    self.assertEqual(self.group(event='workflow_dispatch', ref=ref,
                                                prices_only=prices_only), f'static-site-{ref}{suffix}')
                    self.assertIs(self.workflow['concurrency']['cancel-in-progress'], False)

    def test_finite_ci_runs_group_by_source_head_without_cancelling_active_work(self):
        groups = []
        for head_sha in ('a' * 40, 'b' * 40):
            with self.subTest(head_sha=head_sha):
                group = self.group(event='workflow_run', workflow_run_head_sha=head_sha)
                groups.append(group)
                self.assertEqual(group, f'static-site-oct6-{head_sha}')
                self.assertEqual(self.group(event='workflow_run', workflow_run_head_sha=head_sha,
                                            prices_only='true', schedule='4 16 * * 1-5'), group)
                self.assertIs(self.workflow['concurrency']['cancel-in-progress'], False)
        self.assertNotEqual(groups[0], groups[1])

    def test_combine_truth_table_preserves_fallback_scope_and_honors_cancellation(self):
        condition = self.workflow['jobs']['combine-and-build']['if']
        scopes = (
            ('schedule', 'refs/heads/main', 'main', True),
            ('schedule', 'refs/heads/topic', 'main', False),
            ('schedule', 'refs/heads/trunk', 'trunk', True),
            ('schedule', 'refs/heads/main', 'trunk', False),
            ('workflow_dispatch', 'refs/heads/main', 'main', True),
            ('workflow_dispatch', 'refs/heads/topic', 'main', True),
        )
        for event, ref, default_branch, admitted in scopes:
            for build_result in ('success', 'failure', 'skipped', 'cancelled'):
                for cancelled in (False, True):
                    with self.subTest(event=event, ref=ref, default_branch=default_branch,
                                      build_result=build_result, cancelled=cancelled):
                        self.assertEqual(self.evaluate(condition, event=event, ref=ref,
                                                       default_branch=default_branch,
                                                       build_result=build_result,
                                                       cancelled=cancelled, job_condition=True),
                                         admitted and not cancelled and build_result != 'cancelled')

    def test_finite_combine_requires_positive_admission_and_successful_selector(self):
        condition = self.workflow['jobs']['combine-and-build']['if']
        self.assertEqual(self.workflow['jobs']['combine-and-build']['needs'],
                         ['select-markets', 'build-market'])
        # The finite route always skips build-market. Disabled or rejected
        # admission supplies false/empty, and must never enter ordinary fallback.
        for repair in ('', 'false', 'true'):
            for select_result in ('success', 'failure', 'skipped', 'cancelled'):
                for cancelled in (False, True):
                    with self.subTest(repair=repair, select_result=select_result,
                                      cancelled=cancelled):
                        self.assertEqual(self.evaluate(condition, event='workflow_run',
                                                       repair=repair, select_result=select_result,
                                                       build_result='skipped', cancelled=cancelled,
                                                       job_condition=True),
                                         repair == 'true' and select_result == 'success' and not cancelled)

    def test_disabled_and_admitted_ci_runs_cannot_enter_provider_jobs(self):
        for job in ('ensure_daily_price_release', 'build-market'):
            condition = self.workflow['jobs'][job]['if']
            for repair in ('', 'false', 'true'):
                with self.subTest(job=job, repair=repair):
                    # Successful prerequisites isolate the event guard from
                    # GitHub's implicit success() behavior.
                    self.assertFalse(self.evaluate(condition, event='workflow_run',
                                                   repair=repair, job_condition=True))
            for event in ('schedule', 'workflow_dispatch'):
                with self.subTest(job=job, event=event):
                    self.assertTrue(self.evaluate(condition, event=event, job_condition=True))

    def test_evaluator_still_rejects_unmodelled_context_and_functions(self):
        for expression in ("github.event.workflow_run.unreviewed == 'true'",
                           "needs.select-markets.outputs.unreviewed == 'true'",
                           "unreviewed('true')"):
            with self.subTest(expression=expression):
                with self.assertRaisesRegex(AssertionError, 'requires explicit test support'):
                    self.evaluate(expression)


if __name__ == '__main__':
    unittest.main()
