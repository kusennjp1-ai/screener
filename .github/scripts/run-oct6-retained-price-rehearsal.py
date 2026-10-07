#!/usr/bin/env python3
"""Fixed Oct6 price-only rehearsal, in an isolated Linux network namespace.

The existing supervisor owns the job deadline, process-group termination and
30-second heartbeat. This driver only restores the three pinned archives,
runs the finite graph/compiler phases and reads back a diagnostic checkpoint.
It cannot perform financial carry, select a source, deploy, or call a provider.
"""
import argparse
import ctypes
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIXTURE = HERE / 'fixtures/oct6-retained-price-rehearsal'
CONTRACT = json.loads((FIXTURE / 'contract.json').read_text())
REVIEW = json.loads((HERE / 'fixtures/retained-price-recovery-oct6-inputs.json').read_text())
SPEC = importlib.util.spec_from_file_location('oct6_existing_supervisor', HERE / 'run-postcapture-pages-rehearsal.py')
SUPERVISOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPERVISOR)
PHASE_LIMITS = {'restore-source': 15 * 60, 'prepare-exact': 8 * 60,
                'materialize-graph': 20 * 60, 'canonical-compiler': 30 * 60,
                'canonical-history': 12 * 60, 'sync-home': 2 * 60,
                'canonical-quality': 20 * 60, 'verify-complete-graph': 20 * 60}
MAX_REPORT_BYTES = 128 * 1024 ** 2
PROCESS_CLEANUP_SECONDS = 2
# Existing supervisor TERM/KILL waits are each at most ten seconds. Keep those
# and this wrapper's two cleanup waits inside the existing lifecycle deadline.
TERMINATION_RESERVE_SECONDS = 20 + 2 * PROCESS_CLEANUP_SECONDS


class WorkerInterrupted(ValueError):
    pass


def isolated_worker_identity():
    identity = {'pid': os.getpid(), 'process_group': os.getpgrp(), 'session': os.getsid(0)}
    require(identity['pid'] == identity['process_group'] == identity['session'],
            'Worker must own the isolated supervisor session and process group')
    return identity


def subreaper(enabled):
    """Linux adoption lets the outer CLI reap killed grandchildren, too."""
    require(sys.platform == 'linux', 'Owned process cleanup requires Linux')
    libc = ctypes.CDLL(None, use_errno=True)
    previous = ctypes.c_int()
    require(libc.prctl(37, ctypes.byref(previous), 0, 0, 0) == 0, 'Cannot read child-subreaper state')
    require(libc.prctl(36, int(enabled), 0, 0, 0) == 0, 'Cannot set child-subreaper state')
    return bool(previous.value)


def process_table():
    result = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            result[int(path.name)] = {'pid': int(path.name), 'state': fields[0],
                                      'parent': int(fields[1]), 'process_group': int(fields[2]), 'session': int(fields[3])}
        except (OSError, ValueError, IndexError):
            continue  # A process can exit between directory and stat reads.
    return result


def reap_finished_children():
    result = []
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return result
        if pid == 0:
            return result
        result.append({'pid': pid, 'exit_code': os.waitstatus_to_exitcode(status)})


def stop_owned_group(identity, receipt, reason, *, worker=False):
    """Terminal cleanup only; no phase creates a detached process group."""
    group = identity['process_group']
    require(identity['pid'] == group == identity['session'], 'Unbound worker process group')
    if worker:
        require(identity == isolated_worker_identity(), 'Refusing to signal another worker group')
        # The worker remains alive to finish TERM cleanup. If descendants ignore
        # TERM, the final group KILL deliberately includes the worker itself.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    else:
        require(group != os.getpgrp(), 'Refusing to signal the outer/unrelated process group')
    record = {'worker': identity, 'reason': reason, 'status': 'terminating', 'grace_seconds': PROCESS_CLEANUP_SECONDS,
              'started_at_epoch': time.time(), 'reaped': []}
    def save():
        try:
            receipt.parent.mkdir(parents=True, exist_ok=True)
            receipt.write_text(json.dumps(record, indent=2) + '\n')
        except OSError as error:
            # A full disk or broken diagnostic sink must never block signals.
            record['receipt_write_error'] = str(error)
            try:
                print(json.dumps({'process_cleanup': record}), flush=True)
            except OSError:
                pass
    def members():
        table = process_table()
        found = [item for item in table.values() if item['process_group'] == group and item['pid'] != os.getpid()]
        for item in found:
            require(item['session'] == group, 'Process group crossed its owned session')
            if not worker:
                # After adoption, every surviving root must still descend from
                # this exact outer CLI. Never signal another task's processes.
                current, seen = item, set()
                while current['parent'] != os.getpid():
                    require(current['pid'] not in seen and current['parent'] in table, 'Process group is not owned by this supervisor')
                    seen.add(current['pid']); current = table[current['parent']]
        return found
    owned = members()
    record['initial_members'] = owned
    save()
    if owned:
        try:
            os.killpg(group, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + PROCESS_CLEANUP_SECONDS
    while time.monotonic() < deadline:
        record['reaped'].extend(reap_finished_children())
        if not members():
            record.update(status='terminated', finished_at_epoch=time.time()); save(); return record
        time.sleep(.02)
    record['remaining_before_kill'] = members()
    if record['remaining_before_kill']:
        record.update(status='group_sigkill_issued', kill_at_epoch=time.time()); save()
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # The worker cannot continue beyond its own terminal group KILL. Its
        # outer subreaper completes the receipt and reaps the whole group.
        if worker:
            os._exit(1)
    deadline = time.monotonic() + PROCESS_CLEANUP_SECONDS
    while time.monotonic() < deadline:
        record['reaped'].extend(reap_finished_children())
        if not members():
            record.update(status='terminated', finished_at_epoch=time.time()); save(); return record
        time.sleep(.02)
    record.update(status='cleanup_failed', finished_at_epoch=time.time()); save()
    raise ValueError('Owned worker descendants survived bounded process-group cleanup')


def run_owned_worker(callback, output):
    identity = isolated_worker_identity()
    require(not output.exists() and output.parent.resolve() == output.parent, 'Worker output must be new under a real parent')
    write(Path(str(output) + '-worker-identity.json'), identity)
    previous_subreaper = subreaper(True)
    previous_handlers = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGINT)}
    def interrupted(number, _frame):
        raise WorkerInterrupted('Worker interrupted by ' + signal.Signals(number).name)
    for number in previous_handlers:
        signal.signal(number, interrupted)
    try:
        return callback()
    except BaseException as error:
        stop_owned_group(identity, output / 'process-cleanup.json', type(error).__name__ + ': ' + str(error), worker=True)
        raise
    finally:
        for number, handler in previous_handlers.items():
            signal.signal(number, handler)
        subreaper(previous_subreaper)


def run_phase_command(command, *, seconds, record, save, cwd=ROOT, environment=None):
    identity = isolated_worker_identity()
    child = None
    try:
        # Inherit the one outer-owned session/group. A separate phase PGID would
        # evade the existing supervisor's last-resort group KILL.
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL)
        record.update(pid=child.pid, worker=identity, exit_code=None, stop_reason=None); save()
        code = child.wait(timeout=seconds)
        record['exit_code'] = code
        if code != 0:
            record['stop_reason'] = 'phase_exit'
            raise subprocess.CalledProcessError(code, command)
        if any(item['process_group'] == identity['process_group'] and item['pid'] != os.getpid()
               and item['state'] != 'Z' for item in process_table().values()):
            record['stop_reason'] = 'phase_descendants_remain'
            raise ValueError('Phase returned with live owned descendants')
    except BaseException as error:
        if child is not None:
            record['exit_code'] = child.poll()
        record['stop_reason'] = record.get('stop_reason') or ('phase_deadline' if isinstance(error, subprocess.TimeoutExpired)
                                                            else 'worker_interrupted' if isinstance(error, WorkerInterrupted) else 'phase_exception')
        save()
        raise


def supervise_owned_worker(command, *, output, seconds, environment, phase_report, heartbeat_seconds=SUPERVISOR.HEARTBEAT_SECONDS):
    identity_path = Path(str(phase_report.parent) + '-worker-identity.json')
    require(not identity_path.exists(), 'Worker identity receipt already exists')
    previous_subreaper = subreaper(True)
    previous_handlers = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGINT)}
    def interrupted(number, _frame):
        raise WorkerInterrupted('Outer supervisor interrupted by ' + signal.Signals(number).name)
    for number in previous_handlers:
        signal.signal(number, interrupted)
    before_children = {pid for pid, item in process_table().items() if item['parent'] == os.getpid()}
    try:
        return SUPERVISOR.run_supervised(command, output=output, seconds=seconds, environment=environment,
                                         phase_report=phase_report, heartbeat_seconds=heartbeat_seconds)
    finally:
        try:
            for number in previous_handlers:
                signal.signal(number, signal.SIG_IGN)
            # This immutable sibling is written before the worker callback,
            # outside data restoration and the changing heartbeat report.
            identity = None
            if identity_path.is_file():
                require(not identity_path.is_symlink() and identity_path.stat().st_size <= 1024, 'Invalid worker identity receipt')
                identity = json.loads(identity_path.read_text())
            else:
                # Cover interruption between Popen and the worker's first write.
                # Match only the newly spawned, direct, isolated exact command.
                for pid, item in process_table().items():
                    if pid in before_children or item['parent'] != os.getpid() or pid != item['process_group'] or pid != item['session']:
                        continue
                    try:
                        argv = Path(f'/proc/{pid}/cmdline').read_bytes().rstrip(b'\0').split(b'\0')
                    except OSError:
                        continue
                    if argv == [os.fsencode(part) for part in command]:
                        require(identity is None, 'Ambiguous owned supervisor child')
                        identity = {key: item[key] for key in ('pid', 'process_group', 'session')}
            if identity is not None:
                stop_owned_group(identity, output / 'group-cleanup.json', 'outer supervisor terminal cleanup')
        finally:
            reap_finished_children()
            subreaper(previous_subreaper)
            for number, handler in previous_handlers.items():
                signal.signal(number, handler)


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def digest_file(path):
    path = Path(path).absolute()
    require(path.resolve(strict=True) == path and path.is_file() and not path.is_symlink(), 'Expected real regular input file')
    before = path.stat()
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    after = path.stat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'File changed while hashing')
    return {'bytes': before.st_size, 'sha256': digest}


def write(path, value):
    with Path(path).open('x') as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
        handle.write('\n')


def storage_required():
    # Already-downloaded ZIPs and installed code occupy space before this check.
    # Three complete payloads bound original tree + materializer staging/audits
    # + compiler/checkpoint growth. The final 8 GiB reserve is never lowered.
    return CONTRACT['reserve_bytes'] + 3 * CONTRACT['source_payload_bytes'] + 256 * 1024 ** 2


def require_storage(free):
    require(type(free) is int and free >= storage_required(),
            f'Insufficient rehearsal storage: need {storage_required()} free bytes, have {free}')
    return {'available_bytes': free, 'required_bytes': storage_required(),
            'reserve_bytes': CONTRACT['reserve_bytes'], 'payload_copies': 3}


def execution_budget(started, now):
    remaining = SUPERVISOR.remaining_budget(started, now)
    require(remaining > TERMINATION_RESERVE_SECONDS, 'No execution budget remains after bounded process cleanup')
    return remaining - TERMINATION_RESERVE_SECONDS


def verify_archives(inputs):
    pins = {'candidate': REVIEW['candidate'], 'prior': REVIEW['prior'],
            'companion': {'bytes': REVIEW['candidate']['companion_bytes'], 'sha256': REVIEW['candidate']['companion_sha256']}}
    result = {}
    for role, pin in pins.items():
        path = Path(inputs[role + '_zip']).absolute()
        require(digest_file(path) == {key: pin[key] for key in ('bytes', 'sha256')}, role + ': original archive changed')
        result[role] = {'path': str(path), **digest_file(path)}
    return result


def read_inputs(path):
    path = path.absolute()
    digest_file(path)
    value = json.loads(path.read_text())
    expected = {'schema_version', 'publication_authority', 'provider_work', 'financial_predecessor_bound',
                'prior_role', 'archive_members', 'candidate_zip', 'companion_zip', 'prior_zip',
                'api_evidence', 'api_evidence_sha256', 'caller', 'approved_ui'}
    require(set(value) == expected and value['schema_version'] == 'oct6-retained-price-rehearsal-inputs-v1', 'Unexpected input contract')
    require(all(value[key] is False for key in ['publication_authority', 'provider_work', 'financial_predecessor_bound']), 'Unexpected input authority')
    require(value['prior_role'] == 'historical_price_evidence_only', 'Historical evidence gained financial authority')
    require(value['archive_members'] == {'candidate': 'artifact.tar', 'companion': 'source.json', 'prior': 'artifact.tar'}, 'Archive member contract changed')
    for role in ['candidate', 'companion', 'prior']:
        require(value[role + '_zip'] == str(path.parent / (role + '.zip')), 'Original archive path changed')
    evidence_path = path.parent / 'api-evidence.json'
    require(value['api_evidence'] == str(evidence_path) and digest_file(evidence_path)['sha256'] == value['api_evidence_sha256'], 'API evidence binding changed')
    evidence = json.loads(evidence_path.read_text())
    require(evidence['schema_version'] == 'oct6-retained-price-rehearsal-api-v1' and evidence['publication_authority'] is False and evidence['provider_work'] is False, 'API evidence authority changed')
    require(value['caller'] == evidence['caller'], 'Caller identity changed')
    require(value['approved_ui'] == CONTRACT['approved_ui'], 'Approved UI differs')
    return value


def ensure_offline(parent_namespace):
    SUPERVISOR.require_network_isolation(parent_namespace, os.readlink('/proc/self/ns/net'), dict(os.environ))
    require(not any(name.startswith(('FINANCIAL_', 'SCREENER_', 'STATIC_')) for name in os.environ),
            'Inherited compiler/carry/validation options are forbidden')
    # A namespace ID alone is insufficient if a route was added afterward.
    routes = Path('/proc/net/route').read_text().splitlines()[1:]
    require(all(not line.split() or line.split()[0] == 'lo' for line in routes), 'Offline rehearsal has an external IPv4 route')
    require(all(line.split()[-1] == 'lo' for line in Path('/proc/net/ipv6_route').read_text().splitlines()), 'Offline rehearsal has an external IPv6 route')


def install_approved_runtime(output):
    expected = CONTRACT['approved_ui']
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, timeout=30).strip().decode()
    require(git('rev-parse', expected['sha'] + '^{tree}') == expected['tree'], 'Approved UI tree differs')
    require(git('rev-parse', expected['sha'] + ':frontend') == expected['frontend_tree'], 'Approved frontend tree differs')
    destination = output / 'runtime'
    destination.mkdir()
    # Only Git-authenticated executable code is loaded, never executable files
    # from the input artifact. No extra checkout or Git operation writes a ref.
    code = ['frontend/src', 'frontend/tools', 'frontend/contracts', 'frontend/package.json', 'frontend/package-lock.json', 'contracts', 'data/ibd_reference']
    process = subprocess.Popen(['git', 'archive', expected['sha'], *code], cwd=ROOT, stdout=subprocess.PIPE)
    size = 0
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for member in archive:
            require(member.name and not member.name.startswith('/') and all(part not in ('', '.', '..') for part in member.name.rstrip('/').split('/')), 'Unsafe runtime Git path')
            require(member.isfile() or member.isdir(), 'Linked/nonregular runtime Git entry')
            size += member.size
            require(size <= 128 * 1024 ** 2, 'Approved runtime exceeds bounded code inventory')
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as sink:
                    shutil.copyfileobj(archive.extractfile(member), sink, 1024 ** 2)
    require(process.wait(timeout=30) == 0, 'Approved Git archive failed')
    write(output / 'runtime.json', {'approved_ui': expected, 'runtime_code_bytes': size, 'paths': code,
                                  'ui_browser_build_verified': False})


def tree_inventory(root):
    result = {}
    for current, directories, names in os.walk(root, followlinks=False):
        for name in directories + names:
            require(not (Path(current) / name).is_symlink(), 'Linked checkpoint entry')
        for name in names:
            path = Path(current) / name
            result[path.relative_to(root).as_posix()] = digest_file(path)
    require(len(result) <= CONTRACT['max_checkpoint_files'], 'Checkpoint file count exceeded')
    require(sum(ref['bytes'] for ref in result.values()) <= CONTRACT['max_checkpoint_bytes'], 'Checkpoint logical bytes exceeded')
    return dict(sorted(result.items()))


def checkpoint(root, output, metadata):
    """One deterministic compressed TAR, then independent streaming byte readback."""
    inventory = tree_inventory(root)
    # Validate every USTAR path before creating any output. Audit files use a
    # full digest basename; their original names are retained in the receipt.
    tar_bound = sum(len(tarfile.TarInfo('site/' + name).tobuf(format=tarfile.USTAR_FORMAT))
                    + ((ref['bytes'] + 511) // 512) * 512 for name, ref in inventory.items()) + 10240
    compressed_bound = tar_bound + tar_bound // 100 + 1024 ** 2
    require(shutil.disk_usage(output).free >= CONTRACT['reserve_bytes'] + compressed_bound,
            'Checkpoint cannot preserve the 8 GiB free reserve')
    descriptor = {**metadata, 'schema_version': 'oct6-retained-price-precarry-checkpoint-v1',
                  'publication_authority': False, 'ready_to_publish': False,
                  'ordinary_source_authority': False, 'financial_carry_verified': False,
                  'tar_format': 'ustar',
                  'file_count': len(inventory), 'logical_bytes': sum(ref['bytes'] for ref in inventory.values()),
                  'files': inventory}
    write(output / 'checkpoint.json', descriptor)
    archive_path = output / 'oct6-retained-price-precarry.tar.gz'
    with archive_path.open('xb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', compresslevel=1, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
                for name, ref in inventory.items():
                    path = root / name
                    require(digest_file(path) == ref, 'Checkpoint source changed before pack: ' + name)
                    member = tarfile.TarInfo('site/' + name)
                    member.size = ref['bytes']
                    member.mode = 0o600
                    with path.open('rb') as source:
                        archive.addfile(member, source)
    require(archive_path.stat().st_size <= CONTRACT['max_checkpoint_bytes'], 'Compressed checkpoint bound exceeded')
    verify_checkpoint(archive_path, inventory)
    require(tree_inventory(root) == inventory, 'Checkpoint tree changed during readback')
    require(shutil.disk_usage(output).free >= CONTRACT['reserve_bytes'], 'Checkpoint exhausted the 8 GiB free reserve')
    result = {'archive': digest_file(archive_path), 'descriptor': digest_file(output / 'checkpoint.json'),
              'readback_files': len(inventory), 'readback_bytes': descriptor['logical_bytes'],
              'publication_authority': False, 'ready_to_publish': False}
    write(output / 'checkpoint-readback.json', result)
    return result


def verify_checkpoint(path, inventory):
    remaining = dict(inventory)
    with tarfile.open(path, mode='r|gz') as archive:
        for member in archive:
            require(member.isfile() and member.name.startswith('site/'), 'Unexpected checkpoint entry')
            name = member.name[5:]
            require(name in remaining, 'Unlisted or duplicate checkpoint member')
            ref = remaining.pop(name)
            require(member.size == ref['bytes'], 'Checkpoint member size differs')
            require(hashlib.file_digest(archive.extractfile(member), 'sha256').hexdigest() == ref['sha256'], 'Checkpoint member digest differs')
    require(not remaining, 'Checkpoint lost files')


def worker(args):
    ensure_offline(args.parent_network_namespace)
    inputs = read_inputs(args.inputs)
    output = args.output.absolute()
    require(output.resolve(strict=False) == output and not output.exists(), 'Rehearsal output must be new and real')
    output.mkdir()
    write(output / 'storage-preflight.json', require_storage(shutil.disk_usage(output).free))
    archives = verify_archives(inputs)
    write(output / 'original-archives.json', archives)
    scopes = output / 'scopes'
    scopes.mkdir()
    report = {'schema_version': 'oct6-retained-price-phases-v1', 'publication_authority': False,
              'worker': isolated_worker_identity(), 'status': 'running', 'current_phase': None, 'phases': []}
    def save():
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    def phase(name, command, seconds, cwd=ROOT, environment=None):
        report['current_phase'] = name
        record = {'name': name, 'status': 'running', 'started_at_epoch': time.time(),
                  'timeout_seconds': seconds, 'free_bytes': shutil.disk_usage(output).free}
        report['phases'].append(record)
        save()
        require(record['free_bytes'] >= CONTRACT['reserve_bytes'], '8 GiB reserve exhausted before phase')
        try:
            run_phase_command(command, cwd=cwd, environment=environment, seconds=seconds, record=record, save=save)
            record['status'] = 'passed'
        except BaseException:
            record['status'] = 'failed'
            report['status'] = 'failed'
            raise
        finally:
            record['finished_at_epoch'] = time.time()
            save()
    try:
        for name, pin in CONTRACT['scopes'].items():
            reviewed = json.loads((FIXTURE / (name + '.json')).read_text())
            write(scopes / (name + '-request.json'), reviewed['request'])
            phase('extract-' + name, [sys.executable, str(HERE / 'read-retained-price-archive.py'),
                  '--archive', archives[pin['archive']]['path'], '--sha256', archives[pin['archive']]['sha256'],
                  '--paths', str(scopes / (name + '-request.json')), '--output', str(scopes / name),
                  '--max-output-bytes', str(reviewed['outputCapBytes'])], 8 * 60)
        with zipfile.ZipFile(archives['companion']['path']) as archive:
            require(archive.namelist() == ['source.json'], 'Unexpected companion ZIP member')
            require(archive.getinfo('source.json').file_size == 376233, 'Companion source member bound differs')
            source = archive.read('source.json')
        require(hashlib.sha256(source).hexdigest() == REVIEW['candidate']['retained_source_json_sha256'], 'Companion member changed')
        (scopes / 'source.json').write_bytes(source)
        install_approved_runtime(output)
        frontend = output / 'runtime/frontend'
        script = str(HERE / 'oct6-retained-price-rehearsal.mjs')
        node = ['node', '--max-old-space-size=3072']
        phase('restore-source', [sys.executable, str(HERE / 'restore-retained-price-candidate.py'),
              '--archive', archives['candidate']['path'], '--bytes', str(archives['candidate']['bytes']),
              '--sha256', archives['candidate']['sha256'], '--output', str(frontend / 'public'),
              '--input-kind', 'checked-export', '--checked-export-companion', archives['companion']['path'],
              '--checked-export-api-evidence', inputs['api_evidence'],
              '--checked-export-api-evidence-sha256', inputs['api_evidence_sha256']], PHASE_LIMITS['restore-source'])
        phase('prepare-exact', [*node, script, 'prepare', str(output)], PHASE_LIMITS['prepare-exact'])
        phase('materialize-graph', [*node, script, 'materialize', str(output)], PHASE_LIMITS['materialize-graph'])
        evaluation = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        environment = {**os.environ, 'FINANCIAL_EVALUATED_AT': evaluation, 'NODE_OPTIONS': '--max-old-space-size=3072'}
        write(output / 'compiler-evaluation.json', {'evaluated_at': evaluation, 'source': 'actual_phase_clock', 'approved_ui': CONTRACT['approved_ui'], 'financial_carry_verified': False})
        phase('canonical-compiler', [*node, str(frontend / 'tools/export-research.mjs')], PHASE_LIMITS['canonical-compiler'], frontend, environment)
        phase('canonical-history', [*node, str(frontend / 'tools/record-candidate-history.mjs')], PHASE_LIMITS['canonical-history'], frontend, environment)
        phase('sync-home', [*node, script, 'sync-home', str(output)], PHASE_LIMITS['sync-home'])
        phase('canonical-quality', [*node, str(frontend / 'tools/check-data-quality.mjs')], PHASE_LIMITS['canonical-quality'], frontend, environment)
        phase('verify-complete-graph', [*node, script, 'verify', str(output)], PHASE_LIMITS['verify-complete-graph'])
        require(verify_archives(inputs) == archives, 'Original archive changed during replay')
        report['current_phase'] = 'pack-and-readback'
        packing = {'name': 'pack-and-readback', 'status': 'running', 'started_at_epoch': time.time(),
                   'deadline': 'existing supervisor process/job deadline', 'free_bytes': shutil.disk_usage(output).free}
        report['phases'].append(packing)
        save()
        checkpoint(frontend / 'public', output, {'input_archives': archives, 'approved_ui': CONTRACT['approved_ui'],
                   'caller': inputs['caller'], 'compiler_evaluated_at': evaluation,
                   'controller_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                   'controller_tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip(),
                   'contract': digest_file(FIXTURE / 'contract.json'), 'validation': digest_file(output / 'validation.json'),
                   'materialization': digest_file(output / 'graph.json')})
        packing.update(status='passed', finished_at_epoch=time.time(), free_bytes_after=shutil.disk_usage(output).free)
        report.update(status='passed_price_only', current_phase=None,
                      pending=['renewed live financial predecessor binding', 'ordinary carry/expiry', 'browser/UI and transport/Pages proof'])
    except BaseException as error:
        report['status'] = 'failed'
        report['failure'] = str(error)
        if report['phases'] and report['phases'][-1]['status'] == 'running':
            report['phases'][-1].update(status='failed', finished_at_epoch=time.time())
        raise
    finally:
        save()


def collect(args):
    """Fixed diagnostic report allowlist, including on a failed/timeout run."""
    output = args.output.absolute()
    destination = args.reports.absolute()
    destination.mkdir(exist_ok=False)
    names = ['storage-preflight.json', 'original-archives.json', 'runtime.json', 'report.json',
             'plan.json', 'prepared.json', 'graph.json', 'home-sync.json', 'validation.json',
             'compiler-evaluation.json', 'checkpoint.json', 'checkpoint-readback.json', 'process-cleanup.json']
    total = 0
    for root, selected in [(output, names), (Path(str(output) + '-supervisor'), ['supervisor.json', 'heartbeat.jsonl', 'console.log', 'group-cleanup.json']),
                           (output.parent, [output.name + '-worker-identity.json'])]:
        for name in selected:
            path = root / name
            if not path.exists():
                continue
            pin = digest_file(path)
            total += pin['bytes']
            require(total <= MAX_REPORT_BYTES, 'Diagnostic reports exceed 128 MiB')
            shutil.copyfile(path, destination / name)
    write(destination / 'collection.json', {'publication_authority': False, 'collected_bytes': total,
                                         'files': tree_inventory(destination)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--reports', type=Path)
    parser.add_argument('--job-start', type=Path)
    parser.add_argument('--parent-network-namespace')
    parser.add_argument('--worker', action='store_true')
    parser.add_argument('--collect', action='store_true')
    args = parser.parse_args()
    if args.collect:
        require(args.reports is not None and not args.worker, 'Collector requires reports destination')
        collect(args)
        return 0
    require(args.inputs and args.job_start and args.parent_network_namespace, 'Missing finite rehearsal inputs')
    ensure_offline(args.parent_network_namespace)
    if args.worker:
        run_owned_worker(lambda: worker(args), args.output.absolute())
        return 0
    inputs = read_inputs(args.inputs)
    evidence = json.loads(Path(inputs['api_evidence']).read_text())
    started = SUPERVISOR.actual_job_start(float(args.job_start.read_text()), evidence)
    seconds = execution_budget(started, time.time())
    result = supervise_owned_worker([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--worker'],
            output=Path(str(args.output.absolute()) + '-supervisor'), seconds=seconds,
            environment=dict(os.environ), phase_report=args.output.absolute() / 'report.json')
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        print('Oct6 rehearsal refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
