"""Small real process trees prove cleanup, rather than mocking kill calls."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('financial-renewal-validation-supervisor.py')
SPEC = importlib.util.spec_from_file_location('renewal_supervisor', SCRIPT)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


TREE = r'''
import json,os,signal,subprocess,sys,time
from pathlib import Path
root,mode,depth=Path(sys.argv[1]),sys.argv[2],int(sys.argv[3])
signal.signal(signal.SIGTERM,signal.SIG_IGN)
signal.signal(signal.SIGINT,signal.SIG_IGN)
with (root/'pids.jsonl').open('a') as out:
 out.write(json.dumps({'pid':os.getpid(),'depth':depth,'group':os.getpgrp(),'session':os.getsid(0)})+'\n')
if depth<2:
 subprocess.Popen([sys.executable,__file__,str(root),mode,str(depth+1)],start_new_session=(mode=='detached'))
else:
 (root/'ready').write_text('ready')
if depth==0:
 print('diagnostic-start',flush=True)
 if mode=='flood':
  sys.stdout.write('x'*(512*1024)+'\n');sys.stdout.flush()
 while not (root/'ready').exists():time.sleep(.005)
 if mode in ['failure','background_success']:
  os._exit(7 if mode=='failure' else 0)
while True:time.sleep(.02)
'''


OUTER = r'''
import importlib.util,json,os,signal,subprocess,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=Path(sys.argv[2]);mode=sys.argv[3]
# Both a live unrelated direct child and its exited sibling predate the worker.
witness=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
zombie=subprocess.Popen([sys.executable,'-c','raise SystemExit(23)'])
(root/'witness').write_text(str(witness.pid))
time.sleep(.06)
if mode in ['report_failure','terminal_report_failure']:
 original=m.ReportSink.save
 def save(self,report):
  if (root/'ready').exists() and (mode=='report_failure' or report['status']!='running'):
   raise OSError(28,'simulated full report disk')
  return original(self,report)
 m.ReportSink.save=save
now=time.monotonic()
try:
 result=m.supervise([sys.executable,str(root/'tree.py'),str(root),mode,'0'],
  reports=root,phase='verification',environment=dict(os.environ),heartbeat_seconds=.03,
  deadline={'process_deadline_monotonic':now+.65,'cleanup_deadline_monotonic':now+4.65})
 # os.waitpid confirms no unrelated exit status was stolen by subreaping.
 waited,status=os.waitpid(zombie.pid,0);zombie.returncode=os.waitstatus_to_exitcode(status)
 result['unrelated_child_exit_code']=zombie.returncode
 result['unrelated_child_alive']=witness.poll() is None
 (root/'result.json').write_text(json.dumps(result))
finally:
 witness.terminate();witness.wait(timeout=3)
 if zombie.returncode is None:zombie.wait(timeout=3)
raise SystemExit(0 if result['status']=='passed' else 1)
'''


class SupervisorTests(unittest.TestCase):
    def clock(self, epoch=10000, monotonic=5000):
        return {'epoch_seconds': epoch, 'monotonic_seconds': monotonic, 'boot_id': M.boot_id()}

    def process_probe(self, mode, send_signal=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tree.py').write_text(TREE)
            (root / 'outer.py').write_text(OUTER)
            external = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
            supervisor = subprocess.Popen([sys.executable, str(root / 'outer.py'), str(SCRIPT), str(root), mode],
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                limit = time.monotonic() + 5
                while not (root / 'ready').exists() and supervisor.poll() is None and time.monotonic() < limit:
                    time.sleep(.01)
                self.assertTrue((root / 'ready').exists(), 'Three real process generations did not start')
                if send_signal:
                    os.kill(supervisor.pid, send_signal)
                    # A second signal during cleanup must not abort reaping.
                    time.sleep(.03)
                    if supervisor.poll() is None:
                        os.kill(supervisor.pid, send_signal)
                _, errors = supervisor.communicate(timeout=7)
                self.assertEqual(supervisor.returncode, 1, errors.decode())
                result = json.loads((root / 'result.json').read_text())
                self.assertEqual(result['cleanup']['status'], 'terminated', result)
                self.assertEqual(result['cleanup']['remaining_pids'], [])
                self.assertTrue(result['unrelated_child_alive'])
                self.assertEqual(result['unrelated_child_exit_code'], 23)
                self.assertIsNone(external.poll(), 'Unrelated sibling was killed')
                pids = [json.loads(row) for row in (root / 'pids.jsonl').read_text().splitlines()]
                self.assertEqual({row['depth'] for row in pids}, {0, 1, 2})
                for row in pids:
                    self.assertFalse(Path('/proc/' + str(row['pid'])).exists(),
                                     'Owned process survived or was not reaped: ' + str(row))
                self.assertTrue(result['cleanup']['kill_sent'], 'TERM-ignoring process needed KILL')
                if mode == 'detached':
                    self.assertEqual(len({row['session'] for row in pids}), 3)
                if mode in ['report_failure', 'terminal_report_failure']:
                    self.assertIn('simulated full report disk', result['report_write_error'])
                    self.assertIn('simulated full report disk', errors.decode())
                else:
                    report = json.loads((root / 'verification-supervisor.json').read_text())
                    self.assertEqual(report['status'], 'failed')
                    self.assertLessEqual((root / 'verification.log').stat().st_size, M.MAX_LOG_BYTES)
                    self.assertLessEqual((root / 'verification-progress.jsonl').stat().st_size, M.MAX_PROGRESS_BYTES)
                if mode == 'flood':
                    self.assertGreater(result['captured_output_bytes'], M.MAX_LOG_BYTES)
                    self.assertEqual((root / 'verification.log').stat().st_size, M.MAX_LOG_BYTES)
                return result
            finally:
                if supervisor.poll() is None:
                    os.killpg(supervisor.pid, signal.SIGKILL)
                    supervisor.wait(timeout=3)
                if (root / 'pids.jsonl').exists():
                    for row in (root / 'pids.jsonl').read_text().splitlines():
                        try:
                            os.kill(json.loads(row)['pid'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                external.terminate()
                external.wait(timeout=3)
                if supervisor.stdout:
                    supervisor.stdout.close()
                if supervisor.stderr:
                    supervisor.stderr.close()

    def test_timeout_reaps_parent_child_and_grandchild(self):
        result = self.process_probe('timeout')
        self.assertEqual(result['stop_reason'], 'phase_or_original_job_deadline')

    def test_detached_sessions_are_still_owned_and_reaped(self):
        self.process_probe('detached')

    def test_failed_parent_cannot_leave_background_descendants(self):
        result = self.process_probe('failure')
        self.assertEqual(result['exit_code'], 7)
        self.assertEqual(result['stop_reason'], 'phase_exit')

    def test_success_with_background_descendants_is_failure(self):
        result = self.process_probe('background_success')
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['stop_reason'], 'phase_descendants_remain')

    def test_interrupt_and_repeated_interrupt_preserve_cleanup(self):
        for number in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(number=number):
                result = self.process_probe('interrupt', number)
                self.assertEqual(result['stop_reason'], 'interrupted')
                self.assertEqual(result['signal'], number)

    def test_report_write_failure_cannot_bypass_cleanup(self):
        result = self.process_probe('report_failure')
        self.assertEqual(result['stop_reason'], 'supervisor_exception')

    def test_final_report_write_failure_cannot_bypass_cleanup(self):
        self.process_probe('terminal_report_failure')

    def test_noisy_child_cannot_starve_deadline_or_expand_log(self):
        result = self.process_probe('flood')
        self.assertEqual(result['stop_reason'], 'phase_or_original_job_deadline')

    def test_clean_success_has_log_and_no_kill(self):
        with tempfile.TemporaryDirectory() as directory:
            now = time.monotonic()
            result = M.supervise([sys.executable, '-c', 'print("clean diagnostic")'],
                                 reports=Path(directory), phase='retrieval', environment=dict(os.environ),
                                 deadline={'process_deadline_monotonic': now + 2,
                                           'cleanup_deadline_monotonic': now + 6})
            self.assertEqual(result['status'], 'passed')
            self.assertEqual(result['exit_code'], 0)
            self.assertFalse(result['cleanup']['kill_sent'])
            self.assertIn('clean diagnostic', (Path(directory) / 'retrieval.log').read_text())

    def test_original_clock_bounds_all_later_phases(self):
        job = self.clock()
        phase_start = self.clock(11000, 6000)
        value = M.phase_deadline(job, phase_start, 'verification', now_epoch=11100, now_monotonic=6100)
        self.assertEqual(value['process_deadline_monotonic'], 6000 + 35 * 60 - M.CLEANUP_RESERVE_SECONDS)
        late = self.clock(13000, 8000)
        value = M.phase_deadline(job, late, 'verification', now_epoch=13000, now_monotonic=8000)
        self.assertEqual(value['cleanup_deadline_monotonic'], 5000 + 55 * 60)
        self.assertEqual(value['report_reserve_seconds'], 300)
        self.assertEqual(M.SETUP_SECONDS + M.PHASE_SECONDS['retrieval'] + M.PHASE_SECONDS['verification'], M.WORK_SECONDS)

    def test_setup_counts_checkout_and_cannot_reset_original_eight_minutes(self):
        job = self.clock()
        late_setup = self.clock(10300, 5300)
        value = M.phase_deadline(job, late_setup, 'setup', now_epoch=10320, now_monotonic=5320)
        self.assertEqual(value['cleanup_deadline_monotonic'], 5000 + 8 * 60)
        self.assertEqual(value['remaining_work_seconds'], 160 - M.CLEANUP_RESERVE_SECONDS)
        with self.assertRaisesRegex(ValueError, 'expired'):
            M.phase_deadline(job, self.clock(10480, 5480), 'setup', now_epoch=10480, now_monotonic=5480)

    def test_phase_deadline_cannot_be_reset_by_relaunch(self):
        with tempfile.TemporaryDirectory() as directory:
            job = {'schema_version': M.STAMP_SCHEMA, **M.clock_record(), 'job': M.job_identity()}
            first = M.phase_anchor(Path(directory), 'retrieval', job)
            time.sleep(.01)
            second = M.phase_anchor(Path(directory), 'retrieval', job)
            self.assertEqual(first, second)
            with self.assertRaisesRegex(ValueError, 'original job clock'):
                M.phase_anchor(Path(directory), 'retrieval', {**job, 'epoch_seconds': job['epoch_seconds'] + 1})

    def test_exclusive_job_stamp_refuses_reset_symlink_and_wrong_job(self):
        with tempfile.TemporaryDirectory() as directory:
            stamp = Path(directory) / 'start.json'
            original = M.stamp_job_start(stamp)
            self.assertEqual(M.load_job_start(stamp), original)
            with self.assertRaises(FileExistsError):
                M.stamp_job_start(stamp)
            link = Path(directory) / 'link.json'
            link.symlink_to(stamp)
            with self.assertRaises(ValueError):
                M.load_job_start(link)
            with patch.dict(os.environ, {'GITHUB_RUN_ID': 'other-job'}), self.assertRaisesRegex(ValueError, 'identity differs'):
                M.load_job_start(stamp)

    def test_invalid_clock_future_clock_expired_and_other_boot_refuse(self):
        job = self.clock()
        for field, invalid in [('epoch_seconds', float('nan')), ('epoch_seconds', float('inf')),
                               ('monotonic_seconds', True), ('monotonic_seconds', 0),
                               ('epoch_seconds', 12000), ('boot_id', 'other-boot')]:
            with self.subTest(field=field, invalid=invalid), self.assertRaises(ValueError):
                M.phase_deadline({**job, field: invalid}, job, 'retrieval', now_epoch=11000, now_monotonic=6000)
        for elapsed in [12 * 60 - 4, 55 * 60, 60 * 60]:
            with self.subTest(elapsed=elapsed), self.assertRaisesRegex(ValueError, 'expired'):
                M.phase_deadline(job, job, 'retrieval', now_epoch=10000 + elapsed, now_monotonic=5000 + elapsed)

    def test_clock_adjustment_never_increases_global_budget(self):
        job = self.clock()
        phase_start = self.clock(12000, 7000)
        value = M.phase_deadline(job, phase_start, 'verification', now_epoch=12000, now_monotonic=8250)
        self.assertEqual(value['remaining_work_seconds'], 50 - M.CLEANUP_RESERVE_SECONDS)
        value = M.phase_deadline(job, phase_start, 'verification', now_epoch=13250, now_monotonic=7000)
        self.assertEqual(value['remaining_work_seconds'], 50 - M.CLEANUP_RESERVE_SECONDS)

    def test_remaining_setup_counts_initial_elapsed_time(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'start.json'
            stamp = M.stamp_job_start(path)
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                self.assertEqual(M.main(['--remaining', 'setup', '--job-start', str(path)]), 0)
            self.assertLessEqual(int(printed.getvalue()), 480)
            with patch.object(M.time, 'time', return_value=stamp['epoch_seconds'] + 481), \
                 patch.object(M.time, 'monotonic', return_value=stamp['monotonic_seconds'] + 481), \
                 self.assertRaisesRegex(ValueError, 'setup deadline'):
                M.main(['--remaining', 'setup', '--job-start', str(path)])

    def test_cli_rejects_unfixed_wrapper_and_arbitrary_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wrong = root / 'arbitrary.mjs'
            wrong.write_text('throw new Error("must never execute");')
            with self.assertRaisesRegex(ValueError, 'fixed diagnostic wrapper'):
                M.wrapper_command(wrong, root, root / 'candidate', root, 'retrieval')
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                M.main(['--', 'sh', '-c', 'echo unauthorized'])

    def test_fixed_launch_caps_node_and_preserves_original_job_clock(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            wrapper = base / 'financial-renewal-actual-candidate-validation.mjs'
            wrapper.write_text('// fixed local test wrapper')
            root = base / 'root'
            root.mkdir()
            reports = base / 'reports'
            stamp = base / 'start.json'
            job = M.stamp_job_start(stamp)
            with patch.object(M, 'WRAPPER', wrapper), \
                 patch.dict(os.environ, {'NODE_OPTIONS': '--max-old-space-size=12000 --inspect'}), \
                 patch.object(M, 'supervise', return_value={'status': 'passed'}) as launch:
                self.assertEqual(M.main(['--job-start', str(stamp), '--reports', str(reports),
                                         '--phase', 'verification', '--wrapper', str(wrapper),
                                         '--root', str(root), '--candidate', str(base / 'candidate')]), 0)
            command = launch.call_args.args[0]
            self.assertEqual(command[:4], ['node', '--max-old-space-size=3072', str(wrapper), 'verification'])
            self.assertEqual(command[4:], [str(root), str(base / 'candidate'), str(reports)])
            self.assertEqual(launch.call_args.kwargs['environment']['NODE_OPTIONS'], '--max-old-space-size=3072')
            self.assertEqual(M.load_job_start(stamp), job)
            self.assertLessEqual(launch.call_args.kwargs['deadline']['cleanup_deadline_monotonic'],
                                 job['monotonic_seconds'] + M.WORK_SECONDS)


if __name__ == '__main__':
    unittest.main()
