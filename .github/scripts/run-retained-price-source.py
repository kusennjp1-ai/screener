#!/usr/bin/env python3
"""Finite offline #419/#99 source replay; online authority belongs to its adapter.

The imported reviewed runner owns isolation, deadlines, resource accounting and
process cleanup. This entry point never invokes its diagnostic worker or borrows
diagnostic source authority. See docs/retained-price-source-worker-interface.md
for its data-only protocol.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPEC = importlib.util.spec_from_file_location('reviewed_oct6_runner', HERE / 'run-oct6-retained-price-rehearsal.py')
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)
require = RUNNER.require
digest_file = RUNNER.digest_file
CONTRACT = RUNNER.CONTRACT
REVIEW = RUNNER.REVIEW
MIB = 1024 ** 2
MAX_JSON = 64 * MIB
MAX_AUDIT = 128 * MIB
AUDIT = 'static-data/retained-price-source-audit'
RESTORATION = 'retained-price-restoration-receipt.json'
SHA = re.compile(r'^[a-f0-9]{64}$')
GIT_SHA = re.compile(r'^[a-f0-9]{40}$')
PUBLIC_ASSETS = {'fire.svg', 'manifest.webmanifest', 'static-transport-capability.json', 'strategy-scorecard.json', 'sw.js'}
UI_ROOTS = {'index.html', 'precache-manifest.json', 'fire.svg', 'manifest.webmanifest', 'static-transport-capability.json', 'sw.js'}
DATA_FILES = {'research-daily.json', 'portfolio-model.json', 'qualification-audit.json', 'ibd-reference.json'}
VITE_DRIVER = "import {build} from 'vite'; await build({configFile:'vite.config.js',publicDir:false,build:{outDir:'dist',emptyOutDir:true}});\n"
BUILD_CONTRACT = {'engine': 'vite', 'config': 'approved_ui/frontend/vite.config.js',
    'driver_sha256': hashlib.sha256(VITE_DRIVER.encode()).hexdigest(),
    'publicDir': False, 'outDir': 'dist', 'emptyOutDir': True, 'VITE_BASE_PATH': '/screener/', 'VITE_STATIC_SITE': 'true',
    'source_data_roots': ['static-data/', *sorted(DATA_FILES)],
    'original_ui_exclusions': ['assets/', *sorted(UI_ROOTS)],
    'approved_public_ui': sorted(PUBLIC_ASSETS - {'strategy-scorecard.json'}),
    'scorecard_collision': 'identical-approved-bytes-required', 'producer_ui_authority': False}
INPUT_KEYS = {'schema_version', 'mode', 'request', 'original_api_evidence', 'invocation_evidence',
              'candidate_zip', 'companion_zip', 'prior_zip', 'approved_ui', 'dependencies', 'producer_declaration'}
RESTORATION_KEYS = {'schema_version', 'scope', 'publication_authority', 'ready_to_publish', 'financial_success_claim',
                    'quality_success_claim', 'fullSiteVerified', 'mode', 'archive', 'archiveStructure', 'restoredFiles',
                    'restoredBytes', 'diskPreflight', 'publication', 'files', 'checked_export'}
GRAPH_RECEIPT_KEYS = {'schema_version', 'publication_authority', 'ready_to_publish', 'full_compiler_passed',
    'financial_success_claim', 'quality_success_claim', 'scope', 'target_as_of_date', 'source_restoration_receipt_sha256',
    'prepared_sha256', 'archive', 'affected_research_rows', 'restored_research_rows', 'quarantined_research_rows',
    'stale_candidate_histories', 'residual_current_rows', 'chart_index_only', 'retained_chart_payloads', 'chart_members_total',
    'ledger_only_absences', 'verified_source_files', 'mutations', 'format_deltas', 'aggregate_equivalence', 'history_rebase',
    'retained_home_histories', 'retained_home_patch_sha256', 'requires_full_rebuild', 'requires_financial_carry', 'pending'}
VALIDATION_KEYS = {'schema_version', 'publication_authority', 'ready_to_publish', 'financial_carry_verified',
    'full_browser_verified', 'rows', 'affected', 'full_row_materialization', 'csv_rows', 'chart_members',
    'restored_prior_histories', 'stale_candidate_histories', 'undated_rows', 'groups', 'coverage',
    'observations_sha256', 'ledger_only_absences', 'checked_at', 'pending'}
PAYLOAD_KEYS = {'schema_version', 'request_sha256', 'approved_ui', 'producer', 'evaluated_at',
    'original_archives', 'source_api', 'files', 'audit', 'build', 'validation', 'graph', 'dependencies'}
API_PREFIX = 'repos/kusennjp1-ai/screener'
OBSERVATION_RESPONSE_KEYS = {'GET ' + API_PREFIX, 'GET ' + API_PREFIX + '/git/ref/heads/main'}
ORIGINAL_RESPONSE_KEYS = {'GET ' + API_PREFIX + '/git/trees/2186101e92e1f71771936831cea0a40e410975f7?recursive=1'}
for _role in ('candidate', 'prior'):
    _pin = REVIEW[_role]
    ORIGINAL_RESPONSE_KEYS.update({'GET ' + API_PREFIX + '/actions/runs/' + str(_pin['run_id']),
        'GET ' + API_PREFIX + '/actions/runs/' + str(_pin['run_id']) + '/attempts/1',
        'GET ' + API_PREFIX + '/git/commits/' + _pin['head_sha'],
        'GET_PAGES ' + API_PREFIX + '/actions/runs/' + str(_pin['run_id']) + '/attempts/1/jobs?per_page=100',
        'GET_PAGES ' + API_PREFIX + '/actions/runs/' + str(_pin['run_id']) + '/artifacts?per_page=100'})


def closed(value, keys, label):
    require(type(value) is dict and set(value) == set(keys), label + ': unexpected schema fields')
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def binding(value):
    raw = canonical(value)
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key: ' + key)
        result[key] = value
    return result


def read_json(path, cap=MAX_JSON):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path and path.is_file(), 'Expected absolute real JSON path')
    require(path.stat().st_size <= cap, 'JSON input exceeds byte limit')
    pin = digest_file(path)
    raw = path.read_bytes()
    require(len(raw) == pin['bytes'] and hashlib.sha256(raw).hexdigest() == pin['sha256'], 'JSON changed while reading')
    return json.loads(raw, object_pairs_hook=no_duplicates, parse_constant=lambda token: require(False, 'Nonfinite JSON number'))


def write(path, value):
    raw = canonical(value)
    require(len(raw) <= MAX_JSON, 'JSON output exceeds byte limit')
    with Path(path).open('xb') as sink:
        sink.write(raw)


def file_ref(ref, *, parent=None, name=None):
    closed(ref, {'path', 'bytes', 'sha256'}, 'Bound file')
    require(type(ref['bytes']) is int and 0 < ref['bytes'] <= MAX_JSON and SHA.fullmatch(ref['sha256']), 'Invalid bound file digest')
    path = Path(ref['path'])
    require(path.is_absolute(), 'Bound input path must be absolute')
    if parent is not None:
        require(path.parent == parent and (name is None or path.name == name), 'Bound input must use its explicit sibling path')
    require(path.resolve(strict=True) == path and path.is_file() and not path.is_symlink(), 'Expected real regular input file')
    require(path.stat().st_size == ref['bytes'], 'Bound input bytes changed: ' + path.name)
    require(digest_file(path) == {key: ref[key] for key in ('bytes', 'sha256')}, 'Bound input bytes changed: ' + path.name)
    return read_json(path)


def timestamp(value):
    require(type(value) is str and value.endswith('Z'), 'Expected UTC producer timestamp')
    try:
        parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        raise ValueError('Invalid producer timestamp') from None
    require(parsed.tzinfo is not None, 'Producer timestamp lacks timezone')
    return parsed.timestamp()


def identity(value, *, completed=False):
    keys = {'run_id', 'run_attempt', 'head_sha', 'job'} | ({'declaration_sha256'} if completed else set())
    closed(value, keys, 'Producer identity')
    require(all(type(value[key]) is int and value[key] > 0 for key in ('run_id', 'run_attempt'))
            and GIT_SHA.fullmatch(value['head_sha']), 'Invalid producer identity')
    closed(value['job'], {'id', 'started_at'} | ({'completed_at'} if completed else set()), 'Producer job')
    require(type(value['job']['id']) is int and value['job']['id'] > 0, 'Invalid producer job ID')
    start = timestamp(value['job']['started_at'])
    if completed:
        require(timestamp(value['job']['completed_at']) >= start and SHA.fullmatch(value['declaration_sha256']), 'Invalid completed producer')
    return value


def producer_identity(inputs, invocation):
    selected = invocation['caller'] if inputs['mode'] == 'producer' else invocation['selected_producer']
    return {key: copy.deepcopy(selected[key]) for key in ('run_id', 'run_attempt', 'head_sha')} | {
        'job': {key: selected['job'][key] for key in ('id', 'started_at')}}


def validate_declaration(inputs, invocation, declaration):
    if inputs['mode'] == 'producer':
        require(declaration is None and inputs['producer_declaration'] is None and invocation['selected_producer'] is None,
                'Producer must sample its own clock; selected declaration is forbidden')
        return
    closed(declaration, PAYLOAD_KEYS, 'Producer declaration')
    selected = identity(invocation['selected_producer'], completed=True)
    require(declaration['schema_version'] == 'retained-price-source-payload-v1', 'Unknown producer declaration')
    require(inputs['producer_declaration']['sha256'] == selected['declaration_sha256'], 'Unauthenticated producer declaration')
    require(declaration['producer'] == producer_identity(inputs, invocation), 'Producer declaration origin differs')
    require(declaration['request_sha256'] == inputs['request']['sha256'] and declaration['approved_ui'] == CONTRACT['approved_ui'],
            'Producer declaration request/UI binding differs')
    evaluated = timestamp(declaration['evaluated_at'])
    require(timestamp(selected['job']['started_at']) <= evaluated <= timestamp(selected['job']['completed_at']),
            'Producer evaluation is outside authenticated producer job')


def choose_evaluation(inputs, invocation, declaration, *, now=None):
    validate_declaration(inputs, invocation, declaration)
    if inputs['mode'] == 'replay':
        return declaration['evaluated_at']
    observed = datetime.now(timezone.utc) if now is None else now
    value = observed.isoformat().replace('+00:00', 'Z')
    require(timestamp(value) >= timestamp(invocation['caller']['job']['started_at']), 'Producer clock precedes its genuine job')
    return value


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=30, text=True).strip()


def read_inputs(path):
    path = Path(path).absolute()
    value = closed(read_json(path), INPUT_KEYS, 'Worker inputs')
    require(value['schema_version'] == 'retained-price-source-worker-input-v1' and value['mode'] in ('producer', 'replay'), 'Unknown source replay contract')
    require(value['approved_ui'] == CONTRACT['approved_ui'], 'Approved UI changed')
    total = 0
    parsed = {}
    for key, name in [('request', 'request.json'), ('original_api_evidence', 'original-api-evidence.json'),
                      ('invocation_evidence', 'invocation-evidence.json')]:
        parsed[key] = file_ref(value[key], parent=path.parent, name=name)
        total += value[key]['bytes']
    require(parsed['request'].get('enabled') is True, 'Finite source request is disabled')
    for role in ('candidate', 'companion', 'prior'):
        require(value[role + '_zip'] == str(path.parent / (role + '.zip')), 'Unexpected original archive path')
    closed(value['dependencies'], {'node_modules', 'receipt'}, 'Prepared dependencies')
    parsed['dependencies'] = file_ref(value['dependencies']['receipt'], parent=path.parent, name='dependencies.json')
    total += value['dependencies']['receipt']['bytes']
    invocation = closed(parsed['invocation_evidence'], {'schema_version', 'mode', 'request_sha256', 'controller', 'caller', 'selected_producer'}, 'Invocation evidence')
    require(invocation['schema_version'] == 'retained-price-source-invocation-v1' and invocation['mode'] == value['mode'], 'Invocation role differs')
    require(invocation['request_sha256'] == value['request']['sha256'], 'Invocation request differs')
    closed(invocation['controller'], {'head', 'tree'}, 'Controller identity')
    require(all(GIT_SHA.fullmatch(invocation['controller'][key]) for key in ('head', 'tree')), 'Invalid controller identity')
    identity(invocation['caller'])
    declaration = None
    if value['producer_declaration'] is not None:
        declaration = file_ref(value['producer_declaration'], parent=path.parent, name='producer-declaration.json')
        total += value['producer_declaration']['bytes']
    require(total <= MAX_AUDIT, 'Bound input evidence exceeds aggregate limit')
    validate_declaration(value, invocation, declaration)
    source_api_projection(parsed['original_api_evidence'])
    return value, parsed, declaration


def source_api_projection(evidence):
    closed(evidence, {'schema_version', 'publication_authority', 'provider_work', 'observed_at', 'caller',
        'reviewed_historical_main', 'current_main_observation', 'approved_ui', 'producer_runtime', 'selected',
        'responses', 'response_sha256'}, 'Original API evidence')
    require(evidence['schema_version'] == 'oct6-retained-price-rehearsal-api-v1' and evidence['publication_authority'] is False
            and evidence['provider_work'] is False and evidence['approved_ui'] == CONTRACT['approved_ui'], 'Original API evidence scope differs')
    require(set(evidence['selected']) == {'candidate', 'companion', 'prior'}, 'Original evidence roles changed')
    # Keep entire original records, including unknown nested API properties,
    # original artifact/run/job/deployment/source clocks and all identities.
    # Only the explicitly named current-controller observations are excluded.
    response_keys = ORIGINAL_RESPONSE_KEYS | OBSERVATION_RESPONSE_KEYS
    closed(evidence['responses'], response_keys, 'Original response inventory')
    closed(evidence['response_sha256'], response_keys, 'Original response digest inventory')
    require(all(type(value) is str and SHA.fullmatch(value) for value in evidence['response_sha256'].values()), 'Invalid original response digest')
    immutable = {key: copy.deepcopy(evidence['responses'][key]) for key in sorted(ORIGINAL_RESPONSE_KEYS)}
    hashes = {key: evidence['response_sha256'][key] for key in sorted(ORIGINAL_RESPONSE_KEYS)}
    repository_key = 'GET ' + API_PREFIX
    repository = copy.deepcopy(evidence['responses'][repository_key])
    require(type(repository) is dict, 'Invalid repository observation')
    for field in ('pushed_at', 'updated_at', 'size'):
        repository.pop(field, None)
    immutable[repository_key] = repository
    hashes[repository_key] = binding(repository)['sha256']
    return {key: copy.deepcopy(evidence[key]) for key in ('schema_version', 'publication_authority', 'provider_work',
            'reviewed_historical_main', 'approved_ui', 'producer_runtime', 'selected')} | {
        'immutable_responses': immutable, 'immutable_response_sha256': hashes}


def restoration_projection(receipt, api_evidence, api_pin):
    closed(receipt, RESTORATION_KEYS, 'Restoration receipt')
    closed(receipt['archive'], {'path', 'bytes', 'sha256', 'member', 'tarBytes', 'tarSha256'}, 'Restoration archive')
    closed(receipt['diskPreflight'], {'availableBytes', 'requiredBytes', 'payloadBytes', 'reserveBytes', 'reservePurpose'}, 'Restoration disk observation')
    checked = closed(receipt['checked_export'], {'schema_version', 'publication_authority', 'repository', 'run_id',
        'run_attempt', 'head_sha', 'artifact_id', 'artifact_name', 'archive', 'companion', 'manifest', 'api_evidence',
        'complete_inventory_required'}, 'Checked export declaration')
    require(checked['api_evidence'] == api_pin, 'Restoration API evidence binding differs')
    require(receipt['schema_version'] == 'retained-price-candidate-restoration-v1' and receipt['mode'] == 'checked-export', 'Wrong restoration receipt')
    require(receipt['diskPreflight']['reserveBytes'] == CONTRACT['reserve_bytes'], 'Restoration reserve changed')
    require(receipt['diskPreflight']['availableBytes'] >= receipt['diskPreflight']['requiredBytes'], 'Restoration lacked required storage')
    result = copy.deepcopy(receipt)
    del result['archive']['path']
    del result['diskPreflight']['availableBytes']
    result['checked_export']['api_evidence'] = {'immutable_original_source': binding(source_api_projection(api_evidence))}
    return result


def graph_projection(graph, receipt_pin, projected_receipt):
    closed(graph, {'receipt', 'rows', 'materialized_inventory', 'source_row_bindings'}, 'Graph report')
    closed(graph['receipt'], GRAPH_RECEIPT_KEYS, 'Graph receipt')
    closed(graph['receipt']['archive'], {'path', 'bytes', 'sha256', 'member', 'tarBytes', 'tarSha256'}, 'Graph archive')
    require(graph['receipt']['source_restoration_receipt_sha256'] == receipt_pin['sha256'], 'Graph literal restoration binding differs')
    require(graph['materialized_inventory'].get(RESTORATION) == receipt_pin, 'Graph physical receipt inventory differs')
    require({key: value for key, value in graph['receipt']['archive'].items() if key != 'path'} == projected_receipt['archive'],
            'Graph immutable archive identity differs from restoration')
    result = copy.deepcopy(graph)
    del result['receipt']['archive']['path']
    result['receipt']['source_restoration_receipt_sha256'] = binding(projected_receipt)['sha256']
    result['materialized_inventory'][RESTORATION] = binding(projected_receipt)
    return result


def validation_projection(validation):
    closed(validation, VALIDATION_KEYS, 'Complete price validation')
    timestamp(validation['checked_at'])
    result = copy.deepcopy(validation)
    del result['checked_at']
    return result


def dependency_inventory(root):
    root = Path(root)
    require(root.is_absolute() and root.resolve(strict=True) == root and root.is_dir(), 'Dependencies must be a real absolute directory')
    result, count = {}, 0
    for current, directories, names in os.walk(root, followlinks=False):
        for name in sorted(directories + names):
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                require(path.resolve(strict=True).is_relative_to(root), 'Dependency link escapes prepared tree')
                result[relative] = {'symlink': os.readlink(path)}
            elif path.is_file():
                require(path.stat().st_size <= 2 * 1024 ** 3 - count, 'Prepared dependency bytes exceed bound')
                result[relative] = digest_file(path)
                count += result[relative]['bytes']
            else:
                require(path.is_dir(), 'Nonregular dependency entry')
            require(len(result) <= 100000 and count <= 2 * 1024 ** 3, 'Prepared dependency inventory exceeds bound')
    return dict(sorted(result.items()))


def verify_dependencies(inputs, receipt):
    closed(receipt, {'schema_version', 'approved_ui', 'package_lock', 'node_version', 'npm_version', 'command', 'files'}, 'Dependency receipt')
    require(receipt['schema_version'] == 'retained-price-source-dependencies-v1' and receipt['approved_ui'] == CONTRACT['approved_ui'], 'Unreviewed dependency runtime')
    require(receipt['command'] == ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], 'Dependency installation must use locked reviewed setup')
    raw = subprocess.check_output(['git', 'show', CONTRACT['approved_ui']['sha'] + ':frontend/package-lock.json'], cwd=ROOT, timeout=30)
    require(receipt['package_lock'] == {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}, 'Dependency lockfile differs from approved UI')
    require(subprocess.check_output(['node', '--version'], text=True, timeout=10).strip() == receipt['node_version'], 'Prepared Node version changed')
    require(re.fullmatch(r'\d+\.\d+\.\d+', receipt['npm_version']), 'Invalid prepared npm version')
    require(subprocess.check_output(['npm', '--version'], text=True, timeout=10).strip() == receipt['npm_version'], 'Prepared npm version changed')
    require(dependency_inventory(inputs['dependencies']['node_modules']) == receipt['files'], 'Prepared dependencies changed')


def ensure_offline(parent_namespace):
    RUNNER.ensure_offline(parent_namespace)
    require(not any(name.startswith(('VITE_', 'npm_config_', 'NPM_CONFIG_')) or name in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONSTARTUP')
                    for name in os.environ), 'Inherited build/loader/clock options are forbidden')
    require(sys.version_info[:2] == (3, 11), 'Replay requires original Python 3.11 arithmetic')


def install_build_inputs(output):
    """Extend the unchanged approved compiler checkout with exact build inputs."""
    paths = ['frontend/index.html', 'frontend/vite.config.js', 'frontend/public']
    process = subprocess.Popen(['git', 'archive', CONTRACT['approved_ui']['sha'], *paths], cwd=ROOT, stdout=subprocess.PIPE)
    count, members = 0, set()
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for item in archive:
            require(item.isfile() or item.isdir(), 'Nonregular approved build input')
            parts = item.name.rstrip('/').split('/')
            require(not item.name.startswith('/') and all(part not in ('', '.', '..') for part in parts), 'Unsafe approved build path')
            if item.isdir():
                continue
            require(item.name not in members, 'Duplicate approved build input')
            members.add(item.name)
            if item.name.startswith('frontend/public/'):
                relative = item.name[len('frontend/public/'):]
                require(relative in PUBLIC_ASSETS, 'Unexpected approved public asset')
                destination = output / 'approved-public' / relative
            else:
                require(item.name in paths[:2], 'Unexpected approved build member')
                destination = output / 'runtime' / item.name
            count += item.size
            require(count <= MIB, 'Approved build inputs exceed bound')
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as sink:
                shutil.copyfileobj(archive.extractfile(item), sink, MIB)
    require(process.wait(timeout=30) == 0, 'Approved build Git archive failed')
    require(members == set(paths[:2]) | {'frontend/public/' + name for name in PUBLIC_ASSETS}, 'Incomplete approved build inputs')


def historical_validation_node(node, phase, mode, evaluation, output):
    if mode != 'replay' or phase not in ('canonical-quality', 'verify-complete-graph'):
        return node
    path = output / 'historical-validation-clock.mjs'
    source = ('// Authenticated historical validation only; never imported by producer/carry/admission.\n'
              'const NativeDate = Date; const evaluated = ' + str(int(timestamp(evaluation) * 1000)) + ';\n'
              'globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [evaluated])); }'
              ' static now() { return evaluated; } };\n')
    if path.exists():
        require(path.read_text() == source, 'Historical validation preload changed')
    else:
        path.write_text(source)
    return [*node, '--import', str(path)]


def compose_build(public, dist, approved_public):
    source = RUNNER.tree_inventory(public)
    emitted = RUNNER.tree_inventory(dist)
    require(shutil.disk_usage(dist).free >= CONTRACT['reserve_bytes'] + sum(pin['bytes'] for pin in source.values()) + MIB,
            'Build data copy cannot preserve the 8 GiB reserve')
    require('index.html' in emitted and 'precache-manifest.json' in emitted and any(name.startswith('assets/') for name in emitted),
            'Vite did not emit a genuine frontend')
    require(all(name in {'index.html', 'precache-manifest.json'} or name.startswith('assets/') for name in emitted), 'Unexpected Vite output')
    require(digest_file(public / 'strategy-scorecard.json') == digest_file(approved_public / 'strategy-scorecard.json'),
            'Approved static scorecard collides with source data')
    omitted = {}
    for name, pin in source.items():
        if name in UI_ROOTS or name.startswith('assets/'):
            omitted[name] = pin
            continue
        require(name.startswith('static-data/') or name in DATA_FILES | {RESTORATION, 'strategy-scorecard.json'},
                'Unknown original non-data member: ' + name)
        require(name not in emitted, 'Vite output collides with source data/audit')
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with (public / name).open('rb') as source_file, target.open('xb') as sink:
            shutil.copyfileobj(source_file, sink, MIB)
        require(digest_file(target) == pin, 'Build copy changed source member')
    overlay = {}
    for name in sorted(PUBLIC_ASSETS - {'strategy-scorecard.json'}):
        target = dist / name
        with (approved_public / name).open('rb') as source_file, target.open('xb') as sink:
            shutil.copyfileobj(source_file, sink, MIB)
        overlay[name] = digest_file(target)
    require(RUNNER.tree_inventory(public) == source, 'Build changed source public bytes')
    return {'contract': BUILD_CONTRACT, 'emitted_ui': emitted, 'omitted_inherited_ui': omitted, 'approved_public_ui': overlay}


def audit_sources(output, inputs):
    public = output / 'runtime/frontend/public'
    selected = {name: output / name for name in ('plan.json', 'prepared.json', 'graph.json', 'home-sync.json', 'validation.json', 'compiler-evaluation.json')}
    selected.update({RESTORATION: public / RESTORATION,
                     'original-api-evidence.json': Path(inputs['original_api_evidence']['path']),
                     'invocation-evidence.json': Path(inputs['invocation_evidence']['path']),
                     'request.json': Path(inputs['request']['path']),
                     'dependencies.json': Path(inputs['dependencies']['receipt']['path'])})
    for name in CONTRACT['scopes']:
        selected['scope-' + name + '.json'] = output / 'scopes' / name / 'scoped-extraction-manifest.json'
    return selected


def project_existing_audit(output, inputs, parsed, evaluation):
    public = output / 'runtime/frontend/public'
    audit = public / AUDIT
    selected = audit_sources(output, inputs)
    literal_members = {name: pin for name, pin in RUNNER.tree_inventory(audit).items() if name != 'observation-bindings.json'}
    require(literal_members == {name: digest_file(path) for name, path in selected.items()}, 'Literal audit changed from its original sources')
    projection = {}
    receipt = read_json(public / RESTORATION)
    raw_pin = digest_file(public / RESTORATION)
    projected_receipt = restoration_projection(receipt, parsed['original_api_evidence'],
        {key: inputs['original_api_evidence'][key] for key in ('bytes', 'sha256')})
    projected_graph = graph_projection(read_json(output / 'graph.json'), raw_pin, projected_receipt)
    projected_validation = validation_projection(read_json(output / 'validation.json'))
    for name, path in selected.items():
        if name == RESTORATION:
            projection[name] = binding(projected_receipt)
        elif name == 'graph.json':
            projection[name] = binding(projected_graph)
        elif name == 'validation.json':
            projection[name] = binding(projected_validation)
        elif name == 'original-api-evidence.json':
            projection[name] = binding(source_api_projection(parsed['original_api_evidence']))
        elif name == 'invocation-evidence.json':
            projection[name] = binding({'producer': producer_identity(inputs, parsed['invocation_evidence']),
                                        'request_sha256': inputs['request']['sha256']})
        elif name == 'compiler-evaluation.json':
            projection[name] = binding({'evaluated_at': evaluation, 'approved_ui': CONTRACT['approved_ui']})
        elif name.startswith('scope-'):
            value = read_json(path)
            reviewed = read_json(RUNNER.FIXTURE / (name[len('scope-'):]))
            require(set(value) == set(reviewed) and set(value['archive']) == set(reviewed['archive']), 'Unknown scoped receipt fields')
            del value['archive']['path']
            del reviewed['archive']['path']
            require(value == reviewed, 'Scoped literal receipt differs beyond archive location')
            projection[name] = binding(value)
        else:
            projection[name] = digest_file(path)
    observations = {'schema_version': 'retained-price-source-observation-bindings-v1',
        'restoration': {'literal': raw_pin, 'projection': binding(projected_receipt),
            'variable_fields': ['/archive/path', '/diskPreflight/availableBytes', '/checked_export/api_evidence']},
        'graph': {'literal': digest_file(output / 'graph.json'), 'projection': binding(projected_graph),
            'variable_fields': ['/receipt/archive/path', '/receipt/source_restoration_receipt_sha256', '/materialized_inventory/' + RESTORATION]},
        'validation': {'literal': digest_file(output / 'validation.json'), 'projection': binding(projected_validation), 'variable_fields': ['/checked_at']},
        'api_evidence': {'literal': {key: inputs['original_api_evidence'][key] for key in ('bytes', 'sha256')},
            'projection': binding(source_api_projection(parsed['original_api_evidence'])),
            'variable_fields': ['/observed_at', '/caller', '/current_main_observation',
                '/responses/GET repos~1kusennjp1-ai~1screener/pushed_at', '/responses/GET repos~1kusennjp1-ai~1screener/updated_at',
                '/responses/GET repos~1kusennjp1-ai~1screener/size', '/response_sha256/GET repos~1kusennjp1-ai~1screener',
                '/responses/GET repos~1kusennjp1-ai~1screener~1git~1ref~1heads~1main',
                '/response_sha256/GET repos~1kusennjp1-ai~1screener~1git~1ref~1heads~1main']},
        'literal_members': literal_members, 'semantic_members': projection.copy()}
    projection['observation-bindings.json'] = binding({'schema_version': observations['schema_version'], 'semantic_members': projection.copy()})
    require(sum(pin['bytes'] for pin in RUNNER.tree_inventory(audit).values()) <= MAX_AUDIT, 'Complete source audit exceeds bound')
    return projected_receipt, projected_graph, projected_validation, projection, observations


def prepare_audit(output, inputs, parsed, evaluation):
    public = output / 'runtime/frontend/public'
    audit = public / AUDIT
    require(not audit.exists(), 'Original source occupies reserved source-audit namespace')
    require(shutil.disk_usage(public).free >= CONTRACT['reserve_bytes'] + MAX_AUDIT,
            'Literal source audit cannot preserve the 8 GiB reserve')
    audit.mkdir(parents=True)
    total = 0
    for name, path in audit_sources(output, inputs).items():
        pin = digest_file(path)
        total += pin['bytes']
        require(total <= MAX_AUDIT, 'Literal source audit exceeds 128 MiB')
        with path.open('rb') as source, (audit / name).open('xb') as sink:
            shutil.copyfileobj(source, sink, MIB)
        require(digest_file(audit / name) == pin, 'Literal audit copy differs')
    *projected, observations = project_existing_audit(output, inputs, parsed, evaluation)
    write(audit / 'observation-bindings.json', observations)
    require(sum(pin['bytes'] for pin in RUNNER.tree_inventory(audit).values()) <= MAX_AUDIT, 'Complete source audit exceeds bound')
    return tuple(projected)


def semantic_inventory(physical, projected_receipt, audit_projection):
    result = copy.deepcopy(physical)
    require(RESTORATION in result, 'Physical inventory lacks original receipt')
    result[RESTORATION] = binding(projected_receipt)
    actual_names = {name[len(AUDIT) + 1:] for name in result if name.startswith(AUDIT + '/')}
    require(actual_names == set(audit_projection), 'Physical audit contains missing or unknown members')
    for name, pin in audit_projection.items():
        result[AUDIT + '/' + name] = pin
    return result


def verify_completed_output(output, inputs_path):
    """Read-only adapter recheck; never reruns a compiler or accepts a clock."""
    output = Path(output)
    require(output.is_absolute() and output.resolve(strict=True) == output, 'Invalid completed output path')
    inputs, parsed, declaration = read_inputs(Path(inputs_path))
    payload = closed(read_json(output / 'payload.json'), PAYLOAD_KEYS, 'Completed payload')
    physical = closed(read_json(output / 'physical-inventory.json'), {'schema_version', 'public', 'dist'}, 'Physical inventory')
    require(payload['schema_version'] == 'retained-price-source-payload-v1'
            and physical['schema_version'] == 'retained-price-source-physical-inventory-v1', 'Unknown completed source schema')
    report = read_json(output / 'report.json')
    expected_phases = ['extract-' + name for name in CONTRACT['scopes']] + ['restore-source', 'prepare-exact',
        'materialize-graph', 'canonical-compiler', 'canonical-history', 'sync-home', 'canonical-quality',
        'verify-complete-graph', 'approved-vite-build']
    require(report.get('status') == 'passed_source_replay' and report.get('mode') == inputs['mode']
            and report.get('current_phase') is None and report.get('historical_replay_validation') is (inputs['mode'] == 'replay'),
            'Source worker did not finish its declared mode')
    require([phase['name'] for phase in report['phases']] == expected_phases
            and all(phase['status'] == 'passed' and phase['started_at_epoch'] <= phase['finished_at_epoch'] for phase in report['phases']),
            'Missing or failed genuine replay/build phase')
    require(report['payload'] == digest_file(output / 'payload.json')
            and report['physical_inventory'] == digest_file(output / 'physical-inventory.json'), 'Completed worker descriptor changed')
    frontend = output / 'runtime/frontend'
    for role in ('public', 'dist'):
        require(RUNNER.tree_inventory(frontend / role) == physical[role], 'Complete physical ' + role + ' inventory changed')
    evaluated = closed(read_json(output / 'compiler-evaluation.json'), {'evaluated_at', 'source', 'approved_ui', 'actual_checked_at'}, 'Compiler evaluation')
    require(evaluated['evaluated_at'] == payload['evaluated_at'] and evaluated['approved_ui'] == CONTRACT['approved_ui']
            and evaluated['source'] == ('actual_phase_clock' if inputs['mode'] == 'producer' else 'authenticated_producer_declaration'),
            'Compiler evaluation binding changed')
    timestamp(evaluated['actual_checked_at'])
    receipt, graph, validation, audit, observations = project_existing_audit(output, inputs, parsed, payload['evaluated_at'])
    require(read_json(frontend / 'public' / AUDIT / 'observation-bindings.json') == observations, 'Explicit observation bindings changed')
    require(payload['files'] == semantic_inventory(physical['public'], receipt, audit)
            and payload['audit'] == audit and payload['graph'] == graph and payload['validation'] == validation,
            'Completed immutable source projection changed')
    require(payload['request_sha256'] == inputs['request']['sha256'] and payload['approved_ui'] == CONTRACT['approved_ui']
            and payload['producer'] == producer_identity(inputs, parsed['invocation_evidence'])
            and payload['source_api'] == source_api_projection(parsed['original_api_evidence'])
            and payload['dependencies'] == binding(parsed['dependencies']), 'Completed source identity changed')
    archives = RUNNER.verify_archives(inputs)
    require(payload['original_archives'] == {role: {key: pin[key] for key in ('bytes', 'sha256')} for role, pin in archives.items()},
            'Completed original archive identity changed')
    build = closed(payload['build'], {'contract', 'emitted_ui', 'omitted_inherited_ui', 'approved_public_ui', 'files'}, 'Completed build')
    omitted = {name: pin for name, pin in physical['public'].items() if name in UI_ROOTS or name.startswith('assets/')}
    emitted = {name: pin for name, pin in physical['dist'].items() if name in {'index.html', 'precache-manifest.json'} or name.startswith('assets/')}
    overlay = {name: digest_file(output / 'approved-public' / name) for name in PUBLIC_ASSETS - {'strategy-scorecard.json'}}
    expected_dist = {name: pin for name, pin in physical['public'].items() if name not in omitted} | emitted | overlay
    require(build['contract'] == BUILD_CONTRACT and build['omitted_inherited_ui'] == omitted and build['emitted_ui'] == emitted
            and build['approved_public_ui'] == overlay and physical['dist'] == expected_dist
            and build['files'] == semantic_inventory(physical['dist'], receipt, audit), 'Complete approved build composition changed')
    require('index.html' in emitted and 'precache-manifest.json' in emitted and any(name.startswith('assets/') for name in emitted), 'No genuine Vite outputs')
    require(digest_file(frontend / 'public/strategy-scorecard.json') == digest_file(output / 'approved-public/strategy-scorecard.json'), 'Scorecard collision changed')
    if declaration is not None:
        require(payload == declaration, 'Completed replay no longer equals authenticated producer')
    return {name: digest_file(output / (name + '.json')) for name in ('payload', 'physical-inventory', 'report')}


def worker(args):
    ensure_offline(args.parent_network_namespace)
    inputs, parsed, declaration = read_inputs(args.inputs)
    invocation = parsed['invocation_evidence']
    require(invocation['controller'] == {'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}')}, 'Controller checkout differs from authenticated plan')
    require(git('status', '--porcelain', '--untracked-files=no') == '', 'Tracked controller files are modified')
    output = args.output.absolute()
    require(output.resolve(strict=False) == output and not output.exists(), 'Source output must be new and real')
    require(not output.is_relative_to(args.inputs.absolute().parent), 'Source output overlaps immutable input directory')
    dependencies = Path(inputs['dependencies']['node_modules'])
    require(not output.is_relative_to(dependencies) and not dependencies.is_relative_to(output), 'Output overlaps prepared dependencies')
    output.mkdir()
    write(output / 'storage-preflight.json', RUNNER.require_storage(shutil.disk_usage(output).free))
    verify_dependencies(inputs, parsed['dependencies'])
    archives = RUNNER.verify_archives(inputs)
    write(output / 'original-archives.json', archives)
    report = {'schema_version': 'retained-price-source-phases-v1', 'mode': inputs['mode'], 'status': 'running',
              'worker': RUNNER.isolated_worker_identity(), 'current_phase': None, 'phases': [],
              'historical_replay_validation': inputs['mode'] == 'replay', 'publication_authority': False}
    def save():
        (output / 'report.json').write_bytes(canonical(report))
    def phase(name, command, seconds, cwd=ROOT, environment=None):
        report['current_phase'] = name
        record = {'name': name, 'status': 'running', 'started_at_epoch': time.time(),
                  'timeout_seconds': seconds, 'free_bytes': shutil.disk_usage(output).free}
        report['phases'].append(record)
        save()
        require(record['free_bytes'] >= CONTRACT['reserve_bytes'], '8 GiB reserve exhausted before phase')
        try:
            RUNNER.run_phase_command(command, seconds=seconds, record=record, save=save, cwd=cwd, environment=environment)
            require(shutil.disk_usage(output).free >= CONTRACT['reserve_bytes'], '8 GiB reserve exhausted after phase')
            record['status'] = 'passed'
        finally:
            record['finished_at_epoch'] = time.time()
            save()
    try:
        scopes = output / 'scopes'
        scopes.mkdir()
        for name, pin in CONTRACT['scopes'].items():
            reviewed = read_json(RUNNER.FIXTURE / (name + '.json'))
            write(scopes / (name + '-request.json'), reviewed['request'])
            phase('extract-' + name, [sys.executable, str(HERE / 'read-retained-price-archive.py'),
                '--archive', archives[pin['archive']]['path'], '--sha256', archives[pin['archive']]['sha256'],
                '--paths', str(scopes / (name + '-request.json')), '--output', str(scopes / name),
                '--max-output-bytes', str(reviewed['outputCapBytes'])], 8 * 60)
        with zipfile.ZipFile(archives['companion']['path']) as archive:
            require(archive.namelist() == ['source.json'] and archive.getinfo('source.json').file_size == 376233, 'Companion ZIP shape changed')
            source = archive.read('source.json')
        require(hashlib.sha256(source).hexdigest() == REVIEW['candidate']['retained_source_json_sha256'], 'Companion bytes changed')
        (scopes / 'source.json').write_bytes(source)
        RUNNER.install_approved_runtime(output)
        install_build_inputs(output)
        frontend = output / 'runtime/frontend'
        (frontend / 'node_modules').symlink_to(inputs['dependencies']['node_modules'], target_is_directory=True)
        node = ['node', '--max-old-space-size=3072']
        script = str(HERE / 'oct6-retained-price-rehearsal.mjs')
        phase('restore-source', [sys.executable, str(HERE / 'restore-retained-price-candidate.py'),
            '--archive', archives['candidate']['path'], '--bytes', str(archives['candidate']['bytes']), '--sha256', archives['candidate']['sha256'],
            '--output', str(frontend / 'public'), '--input-kind', 'checked-export', '--checked-export-companion', archives['companion']['path'],
            '--checked-export-api-evidence', inputs['original_api_evidence']['path'],
            '--checked-export-api-evidence-sha256', inputs['original_api_evidence']['sha256']], RUNNER.PHASE_LIMITS['restore-source'])
        for name, command in [('prepare-exact', 'prepare'), ('materialize-graph', 'materialize')]:
            phase(name, [*node, script, command, str(output)], RUNNER.PHASE_LIMITS[name])
        evaluation = choose_evaluation(inputs, invocation, declaration)
        environment = {**os.environ, 'FINANCIAL_EVALUATED_AT': evaluation, 'NODE_OPTIONS': '--max-old-space-size=3072'}
        write(output / 'compiler-evaluation.json', {'evaluated_at': evaluation, 'source': 'actual_phase_clock' if inputs['mode'] == 'producer' else 'authenticated_producer_declaration',
            'approved_ui': CONTRACT['approved_ui'], 'actual_checked_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')})
        for name, script_name in [('canonical-compiler', 'export-research.mjs'), ('canonical-history', 'record-candidate-history.mjs')]:
            phase(name, [*node, str(frontend / 'tools' / script_name)], RUNNER.PHASE_LIMITS[name], frontend, environment)
        phase('sync-home', [*node, script, 'sync-home', str(output)], RUNNER.PHASE_LIMITS['sync-home'])
        quality_node = historical_validation_node(node, 'canonical-quality', inputs['mode'], evaluation, output)
        phase('canonical-quality', [*quality_node, str(frontend / 'tools/check-data-quality.mjs')], RUNNER.PHASE_LIMITS['canonical-quality'], frontend, environment)
        verify_node = historical_validation_node(node, 'verify-complete-graph', inputs['mode'], evaluation, output)
        phase('verify-complete-graph', [*verify_node, script, 'verify', str(output)], RUNNER.PHASE_LIMITS['verify-complete-graph'])
        receipt, graph, validation, audit = prepare_audit(output, inputs, parsed, evaluation)
        # Vite's reviewed config is executed by the real installed Vite build.
        # Public copying is explicit so original compiled UI cannot enter proof.
        build_script = frontend / 'retained-source-vite-build.mjs'
        build_script.write_text(VITE_DRIVER)
        phase('approved-vite-build', [*node, str(build_script)], 20 * 60, frontend,
              {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=3072', 'VITE_BASE_PATH': '/screener/', 'VITE_STATIC_SITE': 'true'})
        build = compose_build(frontend / 'public', frontend / 'dist', output / 'approved-public')
        physical = {'schema_version': 'retained-price-source-physical-inventory-v1',
                    'public': RUNNER.tree_inventory(frontend / 'public'), 'dist': RUNNER.tree_inventory(frontend / 'dist')}
        public_projection = semantic_inventory(physical['public'], receipt, audit)
        dist_projection = semantic_inventory(physical['dist'], receipt, audit)
        payload = {'schema_version': 'retained-price-source-payload-v1', 'request_sha256': inputs['request']['sha256'],
            'approved_ui': CONTRACT['approved_ui'], 'producer': producer_identity(inputs, invocation), 'evaluated_at': evaluation,
            'original_archives': {role: {key: pin[key] for key in ('bytes', 'sha256')} for role, pin in archives.items()},
            'source_api': source_api_projection(parsed['original_api_evidence']), 'files': public_projection, 'audit': audit,
            'build': {**build, 'files': dist_projection}, 'validation': validation, 'graph': graph,
            'dependencies': binding(parsed['dependencies'])}
        closed(payload, PAYLOAD_KEYS, 'Source payload')
        if declaration is not None:
            require(payload == declaration, 'Independent complete replay differs from authenticated producer payload')
        require(RUNNER.verify_archives(inputs) == archives, 'Original archive changed during replay')
        require(read_inputs(args.inputs)[0] == inputs, 'Input contract changed during replay')
        verify_dependencies(inputs, parsed['dependencies'])
        require(shutil.disk_usage(output).free >= CONTRACT['reserve_bytes'], 'Final source exhausted 8 GiB reserve')
        write(output / 'physical-inventory.json', physical)
        write(output / 'payload.json', payload)
        require(read_json(output / 'physical-inventory.json') == physical and read_json(output / 'payload.json') == payload, 'Source descriptor readback differs')
        require(RUNNER.tree_inventory(frontend / 'public') == physical['public'] and RUNNER.tree_inventory(frontend / 'dist') == physical['dist'], 'Complete source/build readback differs')
        report.update(status='passed_source_replay', current_phase=None, payload=digest_file(output / 'payload.json'),
                      physical_inventory=digest_file(output / 'physical-inventory.json'), ordinary_carry_verified=False)
    except BaseException as error:
        report.update(status='failed', failure=str(error))
        if report['phases'] and report['phases'][-1]['status'] == 'running':
            report['phases'][-1]['status'] = 'failed'
        raise
    finally:
        save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--job-start', type=Path, required=True)
    parser.add_argument('--parent-network-namespace', required=True)
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    ensure_offline(args.parent_network_namespace)
    if args.worker:
        RUNNER.run_owned_worker(lambda: worker(args), args.output.absolute())
        return 0
    inputs, parsed, _ = read_inputs(args.inputs)
    require(args.job_start.is_absolute() and args.job_start.stat().st_size <= 128, 'Invalid bounded job-start file')
    digest_file(args.job_start)
    started = RUNNER.SUPERVISOR.actual_job_start(float(args.job_start.read_text()), {'caller': parsed['invocation_evidence']['caller']})
    seconds = RUNNER.execution_budget(started, time.time())
    result = RUNNER.supervise_owned_worker([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--worker'],
        output=Path(str(args.output.absolute()) + '-supervisor'), seconds=seconds,
        environment=dict(os.environ), phase_report=args.output.absolute() / 'report.json')
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        print('Retained source replay refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
