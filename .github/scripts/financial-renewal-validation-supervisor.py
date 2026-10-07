#!/usr/bin/env python3
"""Linux-only finite diagnostic supervisor. No publication or provider authority.

Stamp the original job clock before checkout/setup (the workflow may inline
``stamp_job_start`` when this file has not been checked out). Then launch only
the adjacent fixed Node wrapper. All work, including descendant cleanup, ends
before the original job's 55-minute boundary; five minutes remain for reports.
The owned-process handling follows the d93e2a8 Oct6 rehearsal's subreaper design,
and additionally handles descendants that create their own sessions.
"""

import argparse
import ctypes
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import time


HERE = Path(__file__).resolve().parent
WRAPPER = HERE / 'financial-renewal-actual-candidate-validation.mjs'
STAMP_SCHEMA = 'financial-renewal-validation-job-start-v1'
SETUP_SECONDS = 8 * 60
PHASE_SECONDS = {'setup': SETUP_SECONDS, 'retrieval': 12 * 60, 'verification': 35 * 60}
WORK_SECONDS = 55 * 60
REPORT_RESERVE_SECONDS = 5 * 60
CLEANUP_RESERVE_SECONDS = 4
TERM_SECONDS = 1
KILL_SECONDS = 2
HEARTBEAT_SECONDS = 30
MAX_LOG_BYTES = 256 * 1024
MAX_PROGRESS_BYTES = 64 * 1024
MAX_JSON_BYTES = 32 * 1024
INTERRUPT_SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def boot_id():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def job_identity():
    return {name: os.environ.get(name, '') for name in
            ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB')}


def real_path(path, *, exists=True, directory=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=exists) == path,
            'Expected an absolute path without symlinks: ' + str(path))
    if exists:
        require(path.is_dir() if directory else path.is_file(),
                'Expected a real ' + ('directory: ' if directory else 'file: ') + str(path))
    return path


def read_json(path, max_bytes=MAX_JSON_BYTES):
    path = real_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), 'Expected regular JSON input')
        content = source.read(max_bytes + 1)
    require(len(content) <= max_bytes, 'JSON input exceeds bound')
    return json.loads(content)


def create_json(path, value):
    """Exclusive creation: an existing clock is never replaced or refreshed."""
    path = real_path(path, exists=False)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(descriptor, 'w') as sink:
        json.dump(value, sink, sort_keys=True, allow_nan=False)
        sink.write('\n')
        sink.flush()
        os.fsync(sink.fileno())


def clock_record():
    return {'epoch_seconds': time.time(), 'monotonic_seconds': time.monotonic(),
            'boot_id': boot_id()}


def stamp_job_start(path):
    value = {'schema_version': STAMP_SCHEMA, **clock_record(), 'job': job_identity()}
    create_json(path, value)
    return value


def validate_clock(value, *, now_epoch, now_monotonic):
    require(isinstance(value, dict) and value.get('boot_id') == boot_id(),
            'Clock belongs to a different Linux boot')
    for key, now in [('epoch_seconds', now_epoch), ('monotonic_seconds', now_monotonic)]:
        number = value.get(key)
        require(type(number) in (int, float) and math.isfinite(number) and 0 < number <= now,
                'Invalid or future ' + key)


def load_job_start(path, *, now_epoch=None, now_monotonic=None):
    value = read_json(path)
    now_epoch = time.time() if now_epoch is None else now_epoch
    now_monotonic = time.monotonic() if now_monotonic is None else now_monotonic
    require(isinstance(value, dict) and value.get('schema_version') == STAMP_SCHEMA and value.get('job') == job_identity(),
            'Original job-start identity differs')
    validate_clock(value, now_epoch=now_epoch, now_monotonic=now_monotonic)
    return value


def remaining_since(clock, limit, now_epoch, now_monotonic):
    # Neither a backwards wall clock nor a fresh supervisor can gain time.
    return min(clock['epoch_seconds'] + limit - now_epoch,
               clock['monotonic_seconds'] + limit - now_monotonic)


def phase_deadline(job, phase_start, phase, *, now_epoch, now_monotonic):
    require(phase in PHASE_SECONDS, 'Unknown diagnostic phase')
    validate_clock(job, now_epoch=now_epoch, now_monotonic=now_monotonic)
    validate_clock(phase_start, now_epoch=now_epoch, now_monotonic=now_monotonic)
    require(all(phase_start[key] >= job[key] for key in ('epoch_seconds', 'monotonic_seconds')),
            'Phase begins before original job')
    remaining = min(remaining_since(job, WORK_SECONDS, now_epoch, now_monotonic),
                    remaining_since(phase_start, PHASE_SECONDS[phase], now_epoch, now_monotonic))
    if phase == 'setup':
        # Checkout and tool actions precede this wrapper, and spend the same
        # original eight minutes. Starting dependency installation is no reset.
        remaining = min(remaining, remaining_since(job, SETUP_SECONDS, now_epoch, now_monotonic))
    require(remaining > CLEANUP_RESERVE_SECONDS, 'Original job/phase deadline has expired')
    return {'process_deadline_monotonic': now_monotonic + remaining - CLEANUP_RESERVE_SECONDS,
            'cleanup_deadline_monotonic': now_monotonic + remaining,
            'remaining_work_seconds': remaining - CLEANUP_RESERVE_SECONDS,
            'report_reserve_seconds': REPORT_RESERVE_SECONDS}


def phase_anchor(reports, phase, job):
    path = reports / (phase + '-start.json')
    value = {'schema_version': 'financial-renewal-validation-phase-start-v1',
             'phase': phase, 'original_job_start': job, **clock_record()}
    try:
        create_json(path, value)
    except FileExistsError:
        value = read_json(path)
    require(isinstance(value, dict) and value.get('schema_version') == 'financial-renewal-validation-phase-start-v1'
            and value.get('phase') == phase and value.get('original_job_start') == job,
            'Phase start does not bind the original job clock')
    return value


def process_table():
    result = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            result[int(path.name)] = {'pid': int(path.name), 'state': fields[0],
                                      'parent': int(fields[1]), 'group': int(fields[2]),
                                      'session': int(fields[3]), 'start_ticks': int(fields[19])}
        except (OSError, ValueError, IndexError):
            continue
    return result


def identity(item):
    return (item['pid'], item['start_ticks'])


def set_subreaper(enabled):
    require(sys.platform == 'linux' and hasattr(os, 'pidfd_open')
            and hasattr(signal, 'pidfd_send_signal'), 'Linux pidfd/subreaper support required')
    libc = ctypes.CDLL(None, use_errno=True)
    previous = ctypes.c_int()
    require(libc.prctl(37, ctypes.byref(previous), 0, 0, 0) == 0,
            'Cannot read child-subreaper state')
    require(libc.prctl(36, int(enabled), 0, 0, 0) == 0,
            'Cannot set child-subreaper state')
    return bool(previous.value)


class OwnedProcesses:
    """One dedicated supervisor, one launch, no concurrent unrelated launches.

    Existing children are excluded. A new direct child can only be our worker
    or an adopted descendant, including one that detached before the first
    /proc scan. Start ticks and pidfds prevent signalling a recycled PID.
    """

    def __init__(self):
        self.baseline = {identity(item) for item in process_table().values()
                         if item['parent'] == os.getpid()}
        self.known = set()
        self.child = None
        self.reaped = []

    def members(self):
        table = process_table()
        for item in table.values():
            if item['parent'] == os.getpid() and identity(item) not in self.baseline:
                self.known.add(identity(item))
        changed = True
        while changed:
            changed = False
            for item in table.values():
                parent = table.get(item['parent'])
                if parent and identity(parent) in self.known and identity(item) not in self.known:
                    self.known.add(identity(item))
                    changed = True
        return {pid: item for pid, item in table.items() if identity(item) in self.known}

    def reap(self):
        # waitpid(-1) could steal an unrelated child's exit status.
        if self.child is not None:
            self.child.poll()
        for pid, item in self.members().items():
            if self.child is not None and pid == self.child.pid:
                continue
            if item['parent'] != os.getpid():
                continue
            try:
                reaped, status = os.waitpid(pid, os.WNOHANG)
                if reaped:
                    self.reaped.append({'pid': reaped, 'exit_code': os.waitstatus_to_exitcode(status)})
            except ChildProcessError:
                pass

    def signal_members(self, number):
        members = self.members()
        # Each owned PID is signalled, so separate process groups/sessions are
        # covered without ever broadcasting into an unrelated group.
        for pid, item in members.items():
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            try:
                current = process_table().get(pid)
                if current and identity(current) == identity(item):
                    signal.pidfd_send_signal(descriptor, number)
            except ProcessLookupError:
                pass
            finally:
                os.close(descriptor)

    def cleanup(self, deadline):
        result = {'status': 'terminating', 'initial_pids': sorted(self.members()),
                  'term_sent': False, 'kill_sent': False}
        for number, seconds, field in [(signal.SIGTERM, TERM_SECONDS, 'term_sent'),
                                       (signal.SIGKILL, KILL_SECONDS, 'kill_sent')]:
            until = min(deadline, time.monotonic() + seconds)
            while True:
                self.reap()
                if not self.members():
                    result.update(status='terminated', reaped=self.reaped, remaining_pids=[])
                    return result
                self.signal_members(number)
                result[field] = True
                if time.monotonic() >= until:
                    break
                time.sleep(min(.02, max(0, until - time.monotonic())))
        self.reap()
        remaining = sorted(self.members())
        result.update(status='cleanup_failed' if remaining else 'terminated',
                      remaining_pids=remaining, reaped=self.reaped)
        return result


class ReportSink:
    def __init__(self, directory, phase):
        self.directory = directory
        self.phase = phase
        self.log_tail = bytearray()
        self.progress_tail = bytearray()
        self.total_output_bytes = 0

    def capture(self, content):
        self.total_output_bytes += len(content)
        self.log_tail.extend(content)
        del self.log_tail[:-MAX_LOG_BYTES]

    def write_bytes(self, name, content):
        require(len(content) <= max(MAX_LOG_BYTES, MAX_PROGRESS_BYTES, MAX_JSON_BYTES),
                'Diagnostic report exceeds bound')
        temporary = self.directory / ('.' + name + '.tmp')
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as sink:
            require(stat.S_ISREG(os.fstat(sink.fileno()).st_mode), 'Report sink is not regular')
            sink.write(content)
        os.replace(temporary, self.directory / name)

    def save(self, report):
        progress = {key: report.get(key) for key in
                    ('phase', 'status', 'started_at_epoch', 'updated_at_epoch', 'exit_code', 'stop_reason')}
        progress['output_bytes'] = self.total_output_bytes
        self.progress_tail.extend((json.dumps(progress, sort_keys=True) + '\n').encode())
        if len(self.progress_tail) > MAX_PROGRESS_BYTES:
            del self.progress_tail[:-MAX_PROGRESS_BYTES]
            end = self.progress_tail.find(b'\n')
            if end >= 0:
                del self.progress_tail[:end + 1]
        report['captured_output_bytes'] = self.total_output_bytes
        report['log_tail_bytes'] = len(self.log_tail)
        encoded = (json.dumps(report, sort_keys=True, allow_nan=False, indent=2) + '\n').encode()
        require(len(encoded) <= MAX_JSON_BYTES, 'Supervisor report exceeds bound')
        self.write_bytes(self.phase + '.log', self.log_tail)
        self.write_bytes(self.phase + '-progress.jsonl', self.progress_tail)
        self.write_bytes(self.phase + '-supervisor.json', encoded)


class Interrupted(Exception):
    def __init__(self, number):
        self.number = number
        super().__init__('Interrupted by ' + signal.Signals(number).name)


def supervise(command, *, reports, phase, deadline, environment, heartbeat_seconds=HEARTBEAT_SECONDS):
    """Internal testable runner; CLI deliberately does not accept arbitrary commands."""
    sink = ReportSink(reports, phase)
    report = {'schema_version': 'financial-renewal-validation-supervisor-v1',
              'publication_authority': False, 'phase': phase, 'status': 'running',
              'started_at_epoch': time.time(), 'updated_at_epoch': time.time(),
              'exit_code': None, 'stop_reason': None, 'deadline': deadline}
    previous_subreaper = set_subreaper(True)
    previous_handlers = {number: signal.getsignal(number) for number in INTERRUPT_SIGNALS}
    owned = OwnedProcesses()
    selector = selectors.DefaultSelector()
    child = None
    pending_signal = []

    def interrupted(number, _frame):
        # Avoid the Popen-return/assignment interruption gap. The main loop
        # raises only after it holds the actual child object.
        if not pending_signal:
            pending_signal.append(number)

    for number in previous_handlers:
        signal.signal(number, interrupted)
    try:
        require(time.monotonic() < deadline['process_deadline_monotonic'], 'Execution budget already expired')
        sink.save(report)
        child = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        owned.child = child
        report['pid'] = child.pid
        os.set_blocking(child.stdout.fileno(), False)
        selector.register(child.stdout, selectors.EVENT_READ)
        next_heartbeat = 0
        while True:
            owned.reap()
            if pending_signal:
                raise Interrupted(pending_signal[0])
            now = time.monotonic()
            if now >= deadline['process_deadline_monotonic']:
                report['status'], report['stop_reason'] = 'failed', 'phase_or_original_job_deadline'
                break
            # One bounded read per iteration; a noisy child cannot starve the
            # deadline or signal checks or grow an unbounded output buffer.
            for key, _ in selector.select(min(.05, deadline['process_deadline_monotonic'] - now)):
                content = os.read(key.fd, 64 * 1024)
                if content:
                    sink.capture(content)
                else:
                    selector.unregister(key.fileobj)
            report['exit_code'] = child.poll()
            if now >= next_heartbeat:
                report['updated_at_epoch'] = time.time()
                sink.save(report)
                next_heartbeat = now + heartbeat_seconds
            if report['exit_code'] is not None:
                owned.reap()
                descendants = owned.members()
                report['status'] = 'passed' if report['exit_code'] == 0 and not descendants else 'failed'
                report['stop_reason'] = ('phase_exit' if report['exit_code'] else
                                         'phase_descendants_remain' if descendants else None)
                break
    except BaseException as error:
        report.update(status='failed', stop_reason='interrupted' if isinstance(error, Interrupted) else 'supervisor_exception',
                      error=(type(error).__name__ + ': ' + str(error))[:2000])
        if isinstance(error, Interrupted):
            report['signal'] = error.number
    finally:
        # Cleanup cannot be skipped by a signal, broken pipe, full disk, or a
        # report callback failure. No diagnostic I/O occurs before it finishes.
        for number in previous_handlers:
            signal.signal(number, signal.SIG_IGN)
        try:
            report['cleanup'] = owned.cleanup(min(deadline['cleanup_deadline_monotonic'],
                                                   time.monotonic() + TERM_SECONDS + KILL_SECONDS))
            if report['cleanup']['status'] != 'terminated':
                report.update(status='failed', stop_reason='owned_process_cleanup_failed')
            if child is not None:
                report['exit_code'] = child.poll()
                # Drain at most the bounded pipe capacity after writers stop.
                if child.stdout is not None:
                    for _ in range(16):
                        try:
                            content = os.read(child.stdout.fileno(), 64 * 1024)
                        except BlockingIOError:
                            break
                        if not content:
                            break
                        sink.capture(content)
        except BaseException as error:
            report.update(status='failed', stop_reason='owned_process_cleanup_exception',
                          cleanup_error=(type(error).__name__ + ': ' + str(error))[:2000])
        finally:
            if child is not None and child.stdout is not None:
                child.stdout.close()
            selector.close()
            set_subreaper(previous_subreaper)
            for number, handler in previous_handlers.items():
                signal.signal(number, handler)
        report['updated_at_epoch'] = time.time()
        try:
            sink.save(report)
        except BaseException as error:
            report.update(status='failed', report_write_error=(type(error).__name__ + ': ' + str(error))[:2000])
            try:
                # Console fallback is bounded and contains only supervisor
                # metadata; the child log may contain private diagnostic data.
                print(json.dumps(report, sort_keys=True)[:MAX_JSON_BYTES], file=sys.stderr, flush=True)
            except OSError:
                pass
    return report


def wrapper_command(wrapper, root, candidate, reports, phase):
    require(real_path(wrapper) == WRAPPER, 'Only the adjacent fixed diagnostic wrapper may run')
    root = real_path(root, directory=True)
    candidate = real_path(candidate, exists=False)
    reports = real_path(reports, directory=True)
    require(candidate != root and reports != root and candidate != reports,
            'Root, candidate, and reports must be separate paths')
    return ['node', '--max-old-space-size=3072', str(WRAPPER), phase,
            str(root), str(candidate), str(reports)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stamp-job-start', type=Path)
    parser.add_argument('--job-start', type=Path)
    parser.add_argument('--remaining', choices=['setup'])
    parser.add_argument('--reports', type=Path)
    parser.add_argument('--phase', choices=list(PHASE_SECONDS))
    parser.add_argument('--wrapper', type=Path)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--candidate', type=Path)
    args = parser.parse_args(argv)
    if args.stamp_job_start:
        require(not any((args.job_start, args.remaining, args.reports, args.phase,
                         args.wrapper, args.root, args.candidate)), 'Stamp mode takes no phase options')
        stamp_job_start(args.stamp_job_start)
        return 0
    require(args.job_start is not None, 'Original --job-start is required')
    job = load_job_start(args.job_start)
    if args.remaining:
        require(not any((args.reports, args.phase, args.wrapper, args.root, args.candidate)),
                'Setup budget mode takes no phase options')
        remaining = math.floor(remaining_since(job, SETUP_SECONDS, time.time(), time.monotonic()))
        require(remaining > 0, 'Original setup deadline has expired')
        print(remaining)
        return 0
    require(all((args.reports, args.phase, args.wrapper, args.root, args.candidate)), 'Missing fixed phase arguments')
    reports = real_path(args.reports, exists=False)
    reports.mkdir(parents=True, exist_ok=True)
    command = wrapper_command(args.wrapper, args.root, args.candidate, reports, args.phase)
    phase_start = phase_anchor(reports, args.phase, job)
    deadline = phase_deadline(job, phase_start, args.phase, now_epoch=time.time(), now_monotonic=time.monotonic())
    environment = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=3072'}
    report = supervise(command, reports=reports, phase=args.phase, deadline=deadline, environment=environment)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('Financial renewal diagnostic refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
