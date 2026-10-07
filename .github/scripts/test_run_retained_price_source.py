"""Small adversarial fixtures; never copies/extracts the real 1.9 GiB source."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('retained_source_worker', HERE / 'run-retained-price-source.py')
W = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(W)
H = 'a' * 64
G = 'b' * 40


def original_api():
    selected = {}
    for role in ('candidate', 'companion', 'prior'):
        selected[role] = {'run': {'id': 1, 'created_at': '2026-10-06T20:00:00Z', 'updated_at': '2026-10-06T21:00:00Z'},
            'artifact': {'id': 2, 'created_at': '2026-10-06T20:30:00Z', 'digest': H},
            'producer_job': {'id': 3, 'started_at': '2026-10-06T20:00:00Z', 'completed_at': '2026-10-06T21:00:00Z'},
            'source': {'retrieved_at': '2026-10-06T18:00:00Z'}}
    responses = {key: {'source': key} for key in sorted(W.ORIGINAL_RESPONSE_KEYS | W.OBSERVATION_RESPONSE_KEYS)}
    return {'schema_version': 'oct6-retained-price-rehearsal-api-v1', 'publication_authority': False, 'provider_work': False,
        'observed_at': '2026-10-07T01:00:00Z', 'caller': {'run': 'fresh caller'}, 'reviewed_historical_main': {'sha': G},
        'current_main_observation': {'sha': G}, 'approved_ui': W.CONTRACT['approved_ui'],
        'producer_runtime': {'python_version': '3.11', 'source_sha': G}, 'selected': selected, 'responses': responses,
        'response_sha256': {key: W.binding(value)['sha256'] for key, value in responses.items()}}


def identity():
    return {'run_id': 101, 'run_attempt': 1, 'head_sha': G, 'job': {'id': 1001, 'started_at': '2026-10-07T00:00:00Z'}}


def invocation(mode='producer'):
    result = {'schema_version': 'retained-price-source-invocation-v1', 'mode': mode, 'request_sha256': H,
              'controller': {'head': G, 'tree': G}, 'caller': identity(), 'selected_producer': None}
    if mode == 'replay':
        result['selected_producer'] = identity() | {'declaration_sha256': H}
        result['selected_producer']['job'] = identity()['job'] | {'completed_at': '2026-10-07T01:00:00Z'}
    return result


def declaration():
    value = {key: {} for key in W.PAYLOAD_KEYS}
    value.update(schema_version='retained-price-source-payload-v1', request_sha256=H, approved_ui=W.CONTRACT['approved_ui'],
                 producer=identity(), evaluated_at='2026-10-07T00:30:00.123456Z')
    return value


def clock_inputs(mode='producer'):
    return {'mode': mode, 'producer_declaration': {'sha256': H} if mode == 'replay' else None,
            'request': {'sha256': H}}


def restoration(api_pin):
    value = {key: None for key in W.RESTORATION_KEYS}
    value.update(schema_version='retained-price-candidate-restoration-v1', mode='checked-export',
        archive={'path': '/producer/input/candidate.zip', 'bytes': 12, 'sha256': H, 'member': 'artifact.tar', 'tarBytes': 20, 'tarSha256': H},
        diskPreflight={'availableBytes': 999999999999, 'requiredBytes': 8589934604, 'payloadBytes': 12,
                      'reserveBytes': W.CONTRACT['reserve_bytes'], 'reservePurpose': 'complete reserve'},
        archiveStructure={'regularFiles': 1, 'directories': 1, 'payloadBytes': 12}, restoredFiles=1, restoredBytes=12,
        files={'static-data/a.json': {'bytes': 12, 'sha256': H}},
        checked_export={'schema_version': 'retained-price-checked-export-input-v1', 'publication_authority': False,
            'repository': 'kusennjp1-ai/screener', 'run_id': 37562536786, 'run_attempt': 1, 'head_sha': G,
            'artifact_id': 11461777446, 'artifact_name': 'static-site-data-37562536786-1', 'archive': {'bytes': 12, 'sha256': H},
            'companion': {'bytes': 4, 'sha256': H}, 'manifest': {'bytes': 8, 'sha256': H},
            'api_evidence': api_pin, 'complete_inventory_required': True})
    return value


def graph(receipt_pin):
    receipt = {key: None for key in W.GRAPH_RECEIPT_KEYS}
    receipt.update(source_restoration_receipt_sha256=receipt_pin['sha256'],
        archive={'path': '/producer/input/candidate.zip', 'bytes': 12, 'sha256': H, 'member': 'artifact.tar', 'tarBytes': 20, 'tarSha256': H})
    return {'receipt': receipt, 'rows': {'changed': 101},
            'materialized_inventory': {W.RESTORATION: receipt_pin, 'static-data/a.json': {'bytes': 12, 'sha256': H}},
            'source_row_bindings': [{'symbol': 'LPSN', 'financial_sha256': H}]}


class ClockTests(unittest.TestCase):
    def test_producer_samples_its_real_clock(self):
        actual = datetime(2026, 10, 7, 0, 45, 2, 123, tzinfo=timezone.utc)
        self.assertEqual(W.choose_evaluation(clock_inputs(), invocation(), None, now=actual), '2026-10-07T00:45:02.000123Z')

    def test_producer_refuses_any_supplied_declaration(self):
        with self.assertRaisesRegex(ValueError, 'own clock'):
            W.choose_evaluation(clock_inputs(), invocation(), declaration())

    def test_replay_uses_exact_authenticated_producer_time(self):
        self.assertEqual(W.choose_evaluation(clock_inputs('replay'), invocation('replay'), declaration()), declaration()['evaluated_at'])

    def test_replay_rejects_changed_declaration_hash(self):
        value = clock_inputs('replay'); value['producer_declaration']['sha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'Unauthenticated'):
            W.choose_evaluation(value, invocation('replay'), declaration())

    def test_replay_rejects_forged_producer_identity(self):
        value = declaration(); value['producer']['run_attempt'] += 1
        with self.assertRaisesRegex(ValueError, 'origin differs'):
            W.choose_evaluation(clock_inputs('replay'), invocation('replay'), value)

    def test_replay_rejects_clock_outside_actual_job(self):
        for instant in ('2000-01-01T00:00:00Z', '2026-10-07T01:00:00.000001Z'):
            value = declaration(); value['evaluated_at'] = instant
            with self.subTest(instant=instant), self.assertRaisesRegex(ValueError, 'outside'):
                W.choose_evaluation(clock_inputs('replay'), invocation('replay'), value)

    def test_unknown_declaration_fields_and_naive_clock_reject(self):
        value = declaration(); value['evaluation_override'] = 'bad'
        with self.assertRaisesRegex(ValueError, 'schema'):
            W.validate_declaration(clock_inputs('replay'), invocation('replay'), value)
        with self.assertRaisesRegex(ValueError, 'UTC'):
            W.timestamp('2026-10-07T00:30:00')

    def test_historical_clock_only_enters_replay_validation_children(self):
        node = ['node', '--max-old-space-size=3072']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for mode in ('producer', 'replay'):
                for phase in ('canonical-compiler', 'canonical-history', 'canonical-quality', 'verify-complete-graph',
                              'approved-vite-build', 'ordinary-carry', 'final-recheck', 'api-admission'):
                    result = W.historical_validation_node(node, phase, mode, declaration()['evaluated_at'], root)
                    expected = mode == 'replay' and phase in ('canonical-quality', 'verify-complete-graph')
                    self.assertEqual('--import' in result, expected, (phase, mode))
            source = root / 'historical-validation-clock.mjs'
            if shutil.which('node'):
                raw = subprocess.check_output(['node', '--import', str(source), '--input-type=module', '-e',
                    'console.log(JSON.stringify([Date.now(),new Date().toISOString(),new Date(0).toISOString()]))'], text=True)
                self.assertEqual(json.loads(raw), [1791333000123, '2026-10-07T00:30:00.123Z', '1970-01-01T00:00:00.000Z'])
            source.write_text('Date.now = () => 0;')
            with self.assertRaisesRegex(ValueError, 'preload changed'):
                W.historical_validation_node(node, 'canonical-quality', 'replay', declaration()['evaluated_at'], root)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.api = original_api()
        self.api_pin = W.binding(self.api)
        self.receipt = restoration(self.api_pin)

    def project(self, receipt=None, api=None, pin=None):
        return W.restoration_projection(receipt or self.receipt, api or self.api, pin or self.api_pin)

    def test_only_explicit_operational_receipt_observations_may_differ(self):
        changed_api = copy.deepcopy(self.api)
        changed_api['observed_at'] = '2026-10-07T09:00:00Z'
        changed_api['caller'] = {'fresh': 'new real caller'}
        changed_api['current_main_observation'] = {'sha': 'c' * 40}
        receipt = copy.deepcopy(self.receipt)
        receipt['archive']['path'] = '/independent/replay/candidate.zip'
        receipt['diskPreflight']['availableBytes'] -= 500
        receipt['checked_export']['api_evidence'] = W.binding(changed_api)
        self.assertEqual(self.project(), self.project(receipt, changed_api, W.binding(changed_api)))
        self.assertEqual(self.receipt['archive']['path'], '/producer/input/candidate.zip')
        self.assertEqual(receipt['archive']['path'], '/independent/replay/candidate.zip')

    def test_all_original_identities_and_clocks_remain_immutable(self):
        for role in ('candidate', 'companion', 'prior'):
            for record, field in [('run', 'id'), ('run', 'created_at'), ('run', 'updated_at'), ('artifact', 'created_at'),
                                  ('producer_job', 'started_at'), ('producer_job', 'completed_at'), ('source', 'retrieved_at')]:
                changed = copy.deepcopy(self.api)
                changed['selected'][role][record][field] = 'altered'
                receipt = copy.deepcopy(self.receipt)
                receipt['checked_export']['api_evidence'] = W.binding(changed)
                with self.subTest(role=role, record=record, field=field):
                    self.assertNotEqual(self.project(), self.project(receipt, changed, W.binding(changed)))

    def test_unknown_receipt_field_rejects_instead_of_disappearing(self):
        for path in ('root', 'archive', 'diskPreflight', 'checked_export'):
            receipt = copy.deepcopy(self.receipt)
            (receipt if path == 'root' else receipt[path])['unknown'] = 1
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'schema'):
                self.project(receipt)

    def test_original_logical_file_changes_are_never_projected_away(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['files']['static-data/a.json']['sha256'] = 'c' * 64
        self.assertNotEqual(self.project(), self.project(receipt))

    def test_original_raw_responses_and_hashes_are_immutable_and_unknown_exclusions_fail(self):
        base = W.source_api_projection(self.api)
        for key in W.ORIGINAL_RESPONSE_KEYS:
            changed = copy.deepcopy(self.api); changed['responses'][key]['source'] = 'altered original'
            self.assertNotEqual(base, W.source_api_projection(changed))
            changed = copy.deepcopy(self.api); changed['response_sha256'][key] = 'd' * 64
            self.assertNotEqual(base, W.source_api_projection(changed))
        for key in W.OBSERVATION_RESPONSE_KEYS:
            changed = copy.deepcopy(self.api)
            if key == 'GET ' + W.API_PREFIX:
                changed['responses'][key].update(pushed_at='fresh', updated_at='fresh', size=99)
            else:
                changed['responses'][key] = {'fresh': 'current main observation'}
            changed['response_sha256'][key] = 'd' * 64
            self.assertEqual(base, W.source_api_projection(changed))
        for field in ('id', 'private', 'default_branch', 'owner', 'unknown_field'):
            changed = copy.deepcopy(self.api); changed['responses']['GET ' + W.API_PREFIX][field] = 'changed'
            self.assertNotEqual(base, W.source_api_projection(changed))
        changed = copy.deepcopy(self.api); changed['responses']['GET arbitrary-current-observation'] = {}
        with self.assertRaisesRegex(ValueError, 'schema'):
            W.source_api_projection(changed)

    def test_missing_api_binding_and_reduced_reserve_reject(self):
        receipt = copy.deepcopy(self.receipt)
        receipt['checked_export']['api_evidence']['sha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'API evidence binding'):
            self.project(receipt)
        receipt = copy.deepcopy(self.receipt)
        receipt['diskPreflight']['reserveBytes'] -= 1
        with self.assertRaisesRegex(ValueError, 'reserve changed'):
            self.project(receipt)

    def test_graph_requires_complete_literal_binding_before_projection(self):
        pin = W.binding(self.receipt)
        report = graph(pin)
        result = W.graph_projection(report, pin, self.project())
        self.assertEqual(result['materialized_inventory'][W.RESTORATION], W.binding(self.project()))
        self.assertEqual(report['receipt']['source_restoration_receipt_sha256'], pin['sha256'])
        report['receipt']['source_restoration_receipt_sha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'literal restoration binding'):
            W.graph_projection(report, pin, self.project())

    def test_graph_unknown_field_and_materialized_receipt_change_reject(self):
        pin = W.binding(self.receipt)
        report = graph(pin); report['receipt']['unreviewed'] = True
        with self.assertRaisesRegex(ValueError, 'schema'):
            W.graph_projection(report, pin, self.project())
        report = graph(pin); report['materialized_inventory'][W.RESTORATION] = {'bytes': 1, 'sha256': H}
        with self.assertRaisesRegex(ValueError, 'physical receipt'):
            W.graph_projection(report, pin, self.project())

    def test_validation_only_check_timestamp_varies(self):
        a = {key: None for key in W.VALIDATION_KEYS}; a['checked_at'] = '2026-10-07T00:00:00Z'
        b = copy.deepcopy(a); b['checked_at'] = '2026-10-07T01:00:00Z'
        self.assertEqual(W.validation_projection(a), W.validation_projection(b))
        b['observations_sha256'] = H
        self.assertNotEqual(W.validation_projection(a), W.validation_projection(b))
        b['financial_evaluated_at'] = 0
        with self.assertRaisesRegex(ValueError, 'schema'):
            W.validation_projection(b)

    def test_physical_audit_inventory_is_complete_and_does_not_mutate(self):
        physical = {W.RESTORATION: W.binding(self.receipt), W.AUDIT + '/literal.json': {'bytes': 10, 'sha256': H},
                    'static-data/a.json': {'bytes': 12, 'sha256': H}}
        before = copy.deepcopy(physical)
        projected = W.semantic_inventory(physical, self.project(), {'literal.json': {'bytes': 8, 'sha256': H}})
        self.assertEqual(physical, before)
        self.assertNotEqual(physical[W.RESTORATION], projected[W.RESTORATION])
        physical[W.AUDIT + '/unaccounted.json'] = {'bytes': 1, 'sha256': H}
        with self.assertRaisesRegex(ValueError, 'unknown members'):
            W.semantic_inventory(physical, self.project(), {'literal.json': {'bytes': 8, 'sha256': H}})


class FileAndBuildTests(unittest.TestCase):
    def test_duplicate_nonfinite_and_oversized_json_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            for raw in ('{"same":1,"same":2}', '{"value":NaN}'):
                path.write_text(raw)
                with self.assertRaises(ValueError):
                    W.read_json(path)
            path.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'byte limit'):
                W.read_json(path, cap=1)

    def test_bound_file_rejects_symlink_and_changed_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'a.json'; path.write_text('{}')
            ref = {'path': str(path), **W.digest_file(path)}
            self.assertEqual(W.file_ref(ref, parent=root, name='a.json'), {})
            path.write_text('{ }')
            with self.assertRaisesRegex(ValueError, 'bytes changed'):
                W.file_ref(ref)
            link = root / 'link.json'; link.symlink_to(path)
            with self.assertRaisesRegex(ValueError, 'regular input'):
                W.file_ref({'path': str(link), **W.digest_file(path)})

    def test_dependencies_inventory_binds_internal_links_and_rejects_escapes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); modules = root / 'node_modules'; modules.mkdir()
            (modules / 'package').mkdir(); (modules / 'package/index.js').write_text('exact')
            (modules / 'internal').symlink_to('package/index.js')
            entries = W.dependency_inventory(modules)
            self.assertEqual(entries['internal'], {'symlink': 'package/index.js'})
            (root / 'outside').write_text('unapproved'); (modules / 'escape').symlink_to('../outside')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                W.dependency_inventory(modules)

    def make_build_fixture(self, root):
        public, dist, approved = [root / name for name in ('public', 'dist', 'approved')]
        for path in (public / 'assets', public / 'static-data', dist / 'assets', approved):
            path.mkdir(parents=True)
        for name in W.PUBLIC_ASSETS:
            (approved / name).write_text('approved ' + name)
            (public / name).write_text('approved ' + name if name == 'strategy-scorecard.json' else 'original ' + name)
        (public / 'index.html').write_text('original UI')
        (public / 'precache-manifest.json').write_text('original cache')
        (public / 'assets/old.js').write_text('old compiled UI')
        (public / W.RESTORATION).write_text('literal original receipt')
        (public / 'static-data/manifest.json').write_text('source clock unchanged')
        (dist / 'index.html').write_text('genuine approved Vite index')
        (dist / 'precache-manifest.json').write_text('genuine Vite cache')
        (dist / 'assets/new.js').write_text('approved compiled UI')
        return public, dist, approved

    def test_build_only_copies_closed_data_and_approved_ui(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(W.shutil, 'disk_usage', return_value=SimpleNamespace(free=32 * 1024 ** 3)):
            public, dist, approved = self.make_build_fixture(Path(directory))
            before = W.RUNNER.tree_inventory(public)
            result = W.compose_build(public, dist, approved)
            self.assertEqual(W.RUNNER.tree_inventory(public), before)
            self.assertFalse((dist / 'assets/old.js').exists())
            self.assertEqual((dist / 'static-data/manifest.json').read_text(), 'source clock unchanged')
            self.assertEqual((dist / 'sw.js').read_text(), 'approved sw.js')
            self.assertIn('assets/old.js', result['omitted_inherited_ui'])
            self.assertEqual(result['contract'], W.BUILD_CONTRACT)

    def test_unknown_nondatum_and_scorecard_collision_reject(self):
        for name in ('unreviewed.sh', 'strategy-scorecard.json'):
            with tempfile.TemporaryDirectory() as directory, patch.object(W.shutil, 'disk_usage', return_value=SimpleNamespace(free=32 * 1024 ** 3)):
                public, dist, approved = self.make_build_fixture(Path(directory))
                (public / name).write_text('unexpected')
                with self.subTest(name=name), self.assertRaises(ValueError):
                    W.compose_build(public, dist, approved)

    def test_fake_or_extra_vite_output_rejects(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(W.shutil, 'disk_usage', return_value=SimpleNamespace(free=32 * 1024 ** 3)):
            public, dist, approved = self.make_build_fixture(Path(directory))
            (dist / 'unexpected-data.json').write_text('no')
            with self.assertRaisesRegex(ValueError, 'Unexpected Vite'):
                W.compose_build(public, dist, approved)

    def test_lifecycle_and_reserve_are_reviewed_imports(self):
        self.assertEqual(W.RUNNER.SUPERVISOR.PROCESS_SECONDS, 95 * 60)
        self.assertEqual(W.RUNNER.SUPERVISOR.JOB_SECONDS, 110 * 60)
        self.assertEqual(W.RUNNER.SUPERVISOR.UPLOAD_MARGIN_SECONDS, 10 * 60)
        self.assertEqual(W.CONTRACT['reserve_bytes'], 8 * 1024 ** 3)
        required = W.RUNNER.storage_required()
        with self.assertRaisesRegex(ValueError, 'Insufficient'):
            W.RUNNER.require_storage(required - 1)
        self.assertEqual(W.RUNNER.require_storage(required)['required_bytes'], required)
        self.assertLess(W.RUNNER.execution_budget(1, 1), 95 * 60)

    def test_inherited_compiler_build_and_loader_options_rejected(self):
        for key in ('VITE_BASE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'npm_config_registry'):
            with self.subTest(key=key), patch.object(W.RUNNER, 'ensure_offline'), patch.dict(os.environ, {key: 'override'}, clear=True):
                with self.assertRaisesRegex(ValueError, 'Inherited build'):
                    W.ensure_offline('net:[1]')


class InputContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.inputs = {'schema_version': 'retained-price-source-worker-input-v1', 'mode': 'producer',
            'approved_ui': W.CONTRACT['approved_ui'], 'producer_declaration': None,
            **{role + '_zip': str(self.root / (role + '.zip')) for role in ('candidate', 'companion', 'prior')}}
        self.inputs['request'] = self.put('request.json', {'enabled': True})
        self.inputs['original_api_evidence'] = self.put('original-api-evidence.json', original_api())
        self.inv = invocation(); self.inv['request_sha256'] = self.inputs['request']['sha256']
        self.inputs['invocation_evidence'] = self.put('invocation-evidence.json', self.inv)
        self.inputs['dependencies'] = {'node_modules': str(self.root / 'node_modules'), 'receipt': self.put('dependencies.json', {})}

    def put(self, name, value):
        path = self.root / name
        path.write_bytes(W.canonical(value))
        return {'path': str(path), **W.digest_file(path)}

    def read(self):
        self.put('inputs.json', self.inputs)
        return W.read_inputs(self.root / 'inputs.json')

    def replay(self):
        self.inputs['mode'] = 'replay'
        self.inv = invocation('replay'); self.inv['request_sha256'] = self.inputs['request']['sha256']
        value = declaration(); value['request_sha256'] = self.inputs['request']['sha256']
        self.inputs['producer_declaration'] = self.put('producer-declaration.json', value)
        self.inv['selected_producer']['declaration_sha256'] = self.inputs['producer_declaration']['sha256']
        self.inputs['invocation_evidence'] = self.put('invocation-evidence.json', self.inv)

    def test_valid_minimal_envelope_keeps_online_authority_separate(self):
        # Detailed online origin authentication is the adapter's obligation;
        # this test checks only the worker's closed immutable file envelope.
        self.assertEqual(self.read()[0], self.inputs)
        self.replay()
        self.assertEqual(self.read()[2]['evaluated_at'], declaration()['evaluated_at'])

    def test_disabled_request_and_arbitrary_clock_fields_reject(self):
        self.inputs['request'] = self.put('request.json', {'enabled': False})
        with self.assertRaisesRegex(ValueError, 'disabled'):
            self.read()
        self.inputs['request'] = self.put('request.json', {'enabled': True})
        self.inputs['evaluated_at'] = declaration()['evaluated_at']
        with self.assertRaisesRegex(ValueError, 'schema'):
            self.read()

    def test_wrong_paths_and_changed_bound_api_bytes_reject(self):
        self.inputs['candidate_zip'] = '/arbitrary/elsewhere.zip'
        with self.assertRaisesRegex(ValueError, 'archive path'):
            self.read()
        self.inputs['candidate_zip'] = str(self.root / 'candidate.zip')
        (self.root / 'original-api-evidence.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            self.read()

    def test_changed_or_self_rebound_declaration_without_authenticated_pin_rejects(self):
        self.replay()
        value = W.read_json(self.root / 'producer-declaration.json')
        value['evaluated_at'] = '2026-10-07T00:40:00Z'
        self.put('producer-declaration.json', value)
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            self.read()
        self.inputs['producer_declaration'] = self.put('producer-declaration.json', value)
        with self.assertRaisesRegex(ValueError, 'Unauthenticated'):
            self.read()

    def test_unknown_original_api_fields_reject(self):
        value = original_api(); value['source_clock_override'] = True
        self.inputs['original_api_evidence'] = self.put('original-api-evidence.json', value)
        with self.assertRaisesRegex(ValueError, 'schema'):
            self.read()

    def test_audit_two_passes_keep_raw_receipts_and_match_semantics(self):
        results = []
        for number in (1, 2):
            output = self.root / ('run-' + str(number))
            public = output / 'runtime/frontend/public'; public.mkdir(parents=True)
            value = original_api(); value['observed_at'] = f'2026-10-07T0{number}:00:00Z'
            api_ref = self.put('original-api-evidence.json', value)
            receipt = restoration({key: api_ref[key] for key in ('bytes', 'sha256')})
            receipt['archive']['path'] = str(self.root / ('different-' + str(number)) / 'candidate.zip')
            receipt['diskPreflight']['availableBytes'] -= number
            (public / W.RESTORATION).write_bytes(W.canonical(receipt))
            raw_pin = W.digest_file(public / W.RESTORATION)
            validation = {key: None for key in W.VALIDATION_KEYS}; validation['checked_at'] = f'2026-10-07T0{number}:00:00Z'
            for name, content in [('plan.json', {'plan': 'same'}), ('prepared.json', {'prepared': 'same'}),
                                  ('graph.json', graph(raw_pin)), ('home-sync.json', {'unchanged': True}),
                                  ('validation.json', validation), ('compiler-evaluation.json', {
                                      'evaluated_at': declaration()['evaluated_at'], 'source': 'actual_phase_clock',
                                      'approved_ui': W.CONTRACT['approved_ui'], 'actual_checked_at': f'2026-10-07T0{number}:00:00Z'})]:
                (output / name).write_bytes(W.canonical(content))
            for name in W.CONTRACT['scopes']:
                directory = output / 'scopes' / name; directory.mkdir(parents=True)
                scoped = W.read_json(W.RUNNER.FIXTURE / (name + '.json'))
                scoped['archive']['path'] = str(output / 'source.zip')
                (directory / 'scoped-extraction-manifest.json').write_bytes(W.canonical(scoped))
            inputs = copy.deepcopy(self.inputs); inputs['original_api_evidence'] = api_ref
            parsed = {'original_api_evidence': value, 'invocation_evidence': self.inv, 'dependencies': {}}
            with patch.object(W.shutil, 'disk_usage', return_value=SimpleNamespace(free=32 * 1024 ** 3)):
                projected = W.prepare_audit(output, inputs, parsed, declaration()['evaluated_at'])
            physical = W.RUNNER.tree_inventory(public)
            results.append((projected, physical, W.semantic_inventory(physical, projected[0], projected[3])))
            self.assertEqual((public / W.AUDIT / W.RESTORATION).read_bytes(), (public / W.RESTORATION).read_bytes())
            self.assertEqual(W.digest_file(public / W.RESTORATION), raw_pin)
        self.assertNotEqual(results[0][1], results[1][1])
        self.assertEqual(results[0][0], results[1][0])
        self.assertEqual(results[0][2], results[1][2])

    def test_completed_readback_rejects_missing_genuine_build_phase(self):
        self.read()
        output = self.root / 'completed'; output.mkdir()
        payload = declaration()
        (output / 'payload.json').write_bytes(W.canonical(payload))
        (output / 'physical-inventory.json').write_bytes(W.canonical({
            'schema_version': 'retained-price-source-physical-inventory-v1', 'public': {}, 'dist': {}}))
        report = {'status': 'passed_source_replay', 'mode': 'producer', 'current_phase': None,
                  'historical_replay_validation': False, 'phases': []}
        (output / 'report.json').write_bytes(W.canonical(report))
        with self.assertRaisesRegex(ValueError, 'Missing or failed genuine'):
            W.verify_completed_output(output, self.root / 'inputs.json')
        names = ['extract-' + name for name in W.CONTRACT['scopes']] + ['restore-source', 'prepare-exact',
            'materialize-graph', 'canonical-compiler', 'canonical-history', 'sync-home', 'canonical-quality',
            'verify-complete-graph', 'approved-vite-build']
        report['phases'] = [{'name': name, 'status': 'passed', 'started_at_epoch': 1, 'finished_at_epoch': 2} for name in names]
        report['phases'][-1]['status'] = 'failed'
        (output / 'report.json').write_bytes(W.canonical(report))
        with self.assertRaisesRegex(ValueError, 'Missing or failed genuine'):
            W.verify_completed_output(output, self.root / 'inputs.json')
        report['phases'][-1]['status'] = 'passed'
        report['payload'] = {'bytes': 1, 'sha256': H}; report['physical_inventory'] = {'bytes': 1, 'sha256': H}
        (output / 'report.json').write_bytes(W.canonical(report))
        with self.assertRaisesRegex(ValueError, 'descriptor changed'):
            W.verify_completed_output(output, self.root / 'inputs.json')


if __name__ == '__main__':
    unittest.main()
