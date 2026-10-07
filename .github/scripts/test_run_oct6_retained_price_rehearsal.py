import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('oct6_rehearsal', Path(__file__).with_name('run-oct6-retained-price-rehearsal.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Oct6RehearsalTests(unittest.TestCase):
    def process_probe(self, mode):
        """Real coordinator/child/grandchild, all ignoring TERM, plus outsider."""
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); output = base / 'run'
            node = base / 'tree.mjs'
            node.write_text("""import {spawn} from 'node:child_process';
import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
const [root,mode,depthText]=process.argv.slice(2),depth=Number(depthText);
process.on('SIGTERM',()=>{});
appendFileSync(root+'/pids.jsonl',JSON.stringify({pid:process.pid,depth})+'\\n');
if(depth<2)spawn(process.execPath,[process.argv[1],root,mode,String(depth+1)],{stdio:'inherit'});
else writeFileSync(root+'/ready','ready');
setInterval(()=>{if(depth===0&&['failure','background_success'].includes(mode)&&existsSync(root+'/ready'))process.exit(mode==='failure'?7:0);},10);
""")
            worker = base / 'worker.py'
            worker.write_text("""import importlib.util,json,signal,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
output=Path(sys.argv[2]);mode=sys.argv[3];node=sys.argv[4]
if mode=='write_failure':
 original=Path.write_text
 def fail_receipt(self,*args,**kwargs):
  if self.name=='process-cleanup.json':raise OSError(28,'simulated full diagnostic disk')
  return original(self,*args,**kwargs)
 Path.write_text=fail_receipt
def body():
 output.mkdir()
 if mode=='outer_hard_deadline':signal.signal(signal.SIGTERM,signal.SIG_IGN)
 record={'name':'real-process-probe','status':'running'}
 report={'worker':m.isolated_worker_identity(),'current_phase':'probe','phases':[record]}
 def save():(output/'report.json').write_text(json.dumps(report))
 save()
 try:
  m.run_phase_command(['node',node,str(output),mode,'0'],seconds=2 if mode in ['timeout','write_failure'] else 30,record=record,save=save)
  record['status']='passed'
 except BaseException:
  record['status']='failed';raise
 finally:save()
m.run_owned_worker(body,output)
""")
            outer = base / 'outer.py'
            outer.write_text("""import importlib.util,json,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
output=Path(sys.argv[2]);mode=sys.argv[3]
try:
 result=m.supervise_owned_worker([sys.executable,sys.argv[4],sys.argv[1],str(output),mode,sys.argv[5]],output=Path(str(output)+'-supervisor'),seconds=2.2 if mode in ['outer_deadline','outer_hard_deadline'] else 15,environment=dict(os.environ),phase_report=output/'report.json',heartbeat_seconds=.05)
except BaseException as error:result={'status':'failed','error':type(error).__name__+': '+str(error)}
(output.parent/'result.json').write_text(json.dumps(result))
raise SystemExit(0 if result['status']=='passed' else 1)
""")
            runner_path = str(Path(module.__file__).resolve())
            outsider = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
            process = subprocess.Popen([sys.executable, str(outer), runner_path, str(output), mode, str(worker), str(node)],
                                       start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            identity_path = Path(str(output) + '-worker-identity.json')
            try:
                deadline = time.monotonic() + 5
                while not (output / 'ready').exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.01)
                console = Path(str(output) + '-supervisor') / 'console.log'
                self.assertTrue((output / 'ready').exists(), 'Real grandchild did not start: ' + (console.read_text()[-4000:] if console.exists() else 'no console'))
                identity = json.loads(identity_path.read_text())
                if mode == 'worker_interrupt':
                    os.kill(identity['pid'], signal.SIGTERM)
                if mode == 'outer_interrupt':
                    os.kill(process.pid, signal.SIGTERM)
                _, errors = process.communicate(timeout=16 if mode=='outer_hard_deadline' else 9)
                self.assertNotEqual(process.returncode, 0, errors.decode())
                self.assertIsNone(outsider.poll(), 'Unrelated witness process was signalled')
                owned = [json.loads(line) for line in (output / 'pids.jsonl').read_text().splitlines()]
                self.assertEqual({row['depth'] for row in owned}, {0, 1, 2})
                for row in owned:
                    self.assertFalse(Path(f"/proc/{row['pid']}").exists(), f"Owned process {row} survived or was not reaped")
                group = json.loads((Path(str(output) + '-supervisor') / 'group-cleanup.json').read_text())
                self.assertEqual(group['status'], 'terminated')
                phase = json.loads((output / 'report.json').read_text())['phases'][0]
                self.assertEqual(phase['status'], 'running' if mode=='outer_hard_deadline' else 'failed')
                if mode == 'failure':
                    self.assertEqual(phase['exit_code'], 7)
                    self.assertEqual(phase['stop_reason'], 'phase_exit')
                elif mode in ['timeout', 'write_failure']:
                    self.assertEqual(phase['stop_reason'], 'phase_deadline')
                elif mode == 'background_success':
                    self.assertEqual(phase['exit_code'], 0)
                    self.assertEqual(phase['stop_reason'], 'phase_descendants_remain')
                elif mode == 'outer_hard_deadline':
                    self.assertIsNone(phase['exit_code'])  # Worker was killed before it could observe an exit.
                else:
                    self.assertEqual(phase['stop_reason'], 'worker_interrupted')
                if mode == 'write_failure':
                    self.assertFalse((output / 'process-cleanup.json').exists())
                    self.assertIn('simulated full diagnostic disk', (Path(str(output) + '-supervisor') / 'console.log').read_text())
                if mode in ['outer_deadline', 'outer_hard_deadline']:
                    result = json.loads((base / 'result.json').read_text())
                    self.assertEqual(result['stop_reason'], 'process_deadline')
                return {'mode': mode, 'owned': owned, 'owned_processes_absent': True,
                        'unrelated_process_untouched': outsider.poll() is None,
                        'phase': phase, 'outer_cleanup': group,
                        'result': json.loads((base / 'result.json').read_text())}
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=3)
                if identity_path.exists():
                    try:os.killpg(json.loads(identity_path.read_text())['process_group'], signal.SIGKILL)
                    except ProcessLookupError:pass
                outsider.terminate(); outsider.wait(timeout=3)

    def test_phase_timeout_reaps_coordinator_child_and_grandchild(self):
        self.process_probe('timeout')

    def test_nonzero_coordinator_reaps_background_descendants(self):
        self.process_probe('failure')

    def test_zero_exit_with_background_descendants_is_not_success(self):
        self.process_probe('background_success')

    def test_worker_interruption_cleans_term_ignoring_descendants(self):
        self.process_probe('worker_interrupt')

    def test_outer_deadline_cleans_term_ignoring_descendants(self):
        self.process_probe('outer_deadline')

    def test_outer_last_resort_kill_reaches_an_unresponsive_worker_and_descendants(self):
        self.process_probe('outer_hard_deadline')

    def test_outer_interruption_cleans_term_ignoring_descendants(self):
        self.process_probe('outer_interrupt')

    def test_failed_cleanup_receipt_cannot_prevent_group_termination(self):
        self.process_probe('write_failure')

    def test_worker_cannot_signal_a_different_process_group(self):
        with tempfile.TemporaryDirectory() as directory:
            outsider = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
            try:
                identity = {'pid': outsider.pid, 'process_group': outsider.pid, 'session': outsider.pid}
                with self.assertRaises(ValueError):
                    module.stop_owned_group(identity, Path(directory) / 'receipt.json', 'invalid ownership', worker=True)
                self.assertIsNone(outsider.poll())
            finally:
                outsider.terminate(); outsider.wait(timeout=3)

    def test_clean_phase_preserves_success_and_never_signals_the_outsider(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); output = base / 'run'; script = base / 'worker.py'
            script.write_text("""import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
output=Path(sys.argv[2])
def body():
 output.mkdir();record={}
 def save():(output/'report.json').write_text(json.dumps({'phases':[record]}))
 m.run_phase_command([sys.executable,'-c','print("clean phase")'],seconds=2,record=record,save=save)
m.run_owned_worker(body,output)
""")
            outsider = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
            try:
                with patch.object(module.os, 'killpg', wraps=module.os.killpg) as kill:
                    result = module.supervise_owned_worker([sys.executable, str(script), str(Path(module.__file__).resolve()), str(output)],
                             output=base / 'supervisor', seconds=5, environment=dict(os.environ), phase_report=output / 'report.json', heartbeat_seconds=.05)
                    kill.assert_not_called()
                self.assertEqual(result['status'], 'passed'); self.assertEqual(result['exit_code'], 0)
                self.assertIsNone(outsider.poll())
            finally:
                outsider.terminate(); outsider.wait(timeout=3)

    def test_input_boundary_rejects_relative_paths_authority_and_altered_api_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = {'schema_version': 'oct6-retained-price-rehearsal-api-v1', 'publication_authority': False,
                        'provider_work': False, 'caller': {'job': {'started_at': '2026-10-07T00:00:00Z'}}}
            module.write(root / 'api-evidence.json', evidence)
            value = {'schema_version': 'oct6-retained-price-rehearsal-inputs-v1', 'publication_authority': False,
                     'provider_work': False, 'financial_predecessor_bound': False, 'prior_role': 'historical_price_evidence_only',
                     'archive_members': {'candidate': 'artifact.tar', 'companion': 'source.json', 'prior': 'artifact.tar'},
                     **{role + '_zip': str(root / (role + '.zip')) for role in ['candidate', 'companion', 'prior']},
                     'api_evidence': str(root / 'api-evidence.json'), 'api_evidence_sha256': module.digest_file(root / 'api-evidence.json')['sha256'],
                     'caller': evidence['caller'], 'approved_ui': module.CONTRACT['approved_ui']}
            path = root / 'inputs.json'
            path.write_text(json.dumps(value))
            self.assertEqual(module.read_inputs(path), value)
            for field, bad in [('candidate_zip', 'candidate.zip'), ('publication_authority', True),
                               ('provider_work', True), ('financial_predecessor_bound', True),
                               ('prior_role', 'financial_predecessor'), ('approved_ui', {}), ('caller', {}),
                               ('api_evidence_sha256', 'a' * 64), ('archive_members', {})]:
                path.write_text(json.dumps({**value, field: bad}))
                with self.subTest(field=field), self.assertRaises(ValueError):
                    module.read_inputs(path)

    def test_fixed_budget_preserves_existing_eight_gib_reserve(self):
        self.assertEqual(module.CONTRACT['reserve_bytes'], 8 * 1024 ** 3)
        needed = module.storage_required()
        self.assertEqual(needed, 8 * 1024 ** 3 + 3 * 1876607954 + 256 * 1024 ** 2)
        module.require_storage(needed)
        for value in [needed - 1, 218 * 1024 ** 2, -1, float(needed)]:
            with self.assertRaises(ValueError):
                module.require_storage(value)

    def test_original_hashing_rejects_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'original').write_bytes(b'exact original')
            (root / 'link').symlink_to(root / 'original')
            with self.assertRaisesRegex(ValueError, 'real regular'):
                module.digest_file(root / 'link')
            self.assertEqual(module.digest_file(root / 'original')['bytes'], 14)

    def test_approved_runtime_includes_authenticated_frontend_contract_imports(self):
        contracts = ['static_financial_current_v1', 'native_annual_history_v1', 'financial_instrument_applicability_v1']
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as archive:
            for name in contracts:
                item = tarfile.TarInfo('frontend/contracts/' + name + '.json'); item.size = 2
                archive.addfile(item, io.BytesIO(b'{}'))
        def archive_process(command, **kwargs):
            self.assertEqual(command[:3], ['git', 'archive', module.CONTRACT['approved_ui']['sha']])
            self.assertIn('frontend/contracts', command[3:])
            return SimpleNamespace(stdout=io.BytesIO(data.getvalue()), wait=lambda timeout: 0)
        def git_identity(command, **kwargs):
            expected = module.CONTRACT['approved_ui']
            return (expected['frontend_tree'] if command[-1].endswith(':frontend') else expected['tree']).encode()
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, 'check_output', side_effect=git_identity), patch.object(module.subprocess, 'Popen', side_effect=archive_process):
            output = Path(directory); module.install_approved_runtime(output)
            for name in contracts:
                self.assertEqual((output / 'runtime/frontend/contracts' / (name + '.json')).read_bytes(), b'{}')
            self.assertEqual(json.loads((output / 'runtime.json').read_text())['approved_ui'], module.CONTRACT['approved_ui'])

    @patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024 ** 3))
    def test_checkpoint_retains_every_byte_and_reads_back(self, _disk):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site, output = root / 'site', root / 'out'
            site.mkdir(); output.mkdir()
            (site / 'a.json').write_bytes(b'{ "literal": 1 }\n')
            (site / 'nested').mkdir(); (site / 'nested/b.bin').write_bytes(bytes(range(256)))
            result = module.checkpoint(site, output, {'compiler_evaluated_at': '2026-10-07T00:00:00Z'})
            self.assertEqual(result['readback_files'], 2)
            self.assertFalse(result['publication_authority'])
            descriptor = json.loads((output / 'checkpoint.json').read_text())
            self.assertFalse(descriptor['ordinary_source_authority'])
            self.assertFalse(descriptor['financial_carry_verified'])
            module.verify_checkpoint(output / 'oct6-retained-price-precarry.tar.gz', descriptor['files'])
            bad = dict(descriptor['files']); bad['a.json'] = {'bytes': 16, 'sha256': 'a' * 64}
            with self.assertRaises(ValueError):
                module.verify_checkpoint(output / 'oct6-retained-price-precarry.tar.gz', bad)

    @patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024 ** 3))
    def test_checkpoint_pack_is_deterministic(self, _disk):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); site = root / 'site'; site.mkdir(); (site / 'a').write_bytes(b'old close')
            result = []
            for name in ['first', 'second']:
                dest = root / name; dest.mkdir()
                result.append(module.checkpoint(site, dest, {})['archive'])
            self.assertEqual(result[0], result[1])

    @patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024 ** 3))
    def test_short_full_hash_audit_paths_roundtrip_in_ustar(self, _disk):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); site = root / 'site'; site.mkdir()
            for category, suffix in [('snapshots', '.json.gz'), ('catalogs', '.json'), ('unindexed', '.json.gz')]:
                path = site / 'static-data/retained-price-repair-audit/history' / category / ('a' * 64 + suffix)
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'exact original bytes')
            digests = []
            for name in ['first', 'second']:
                output = root / name; output.mkdir()
                result = module.checkpoint(site, output, {})
                self.assertEqual(result['readback_files'], 3)
                self.assertEqual(json.loads((output / 'checkpoint.json').read_text())['tar_format'], 'ustar')
                digests.append(result['archive'])
            self.assertEqual(digests[0], digests[1])

    @patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024 ** 3))
    def test_unsupported_tar_name_fails_before_checkpoint_output(self, _disk):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); site = root / 'site'; output = root / 'out'; site.mkdir(); output.mkdir()
            (site / ('a' * 101)).write_bytes(b'x')
            with self.assertRaises(ValueError):
                module.checkpoint(site, output, {})
            self.assertEqual(list(output.iterdir()), [])

    @patch.object(module.shutil, 'disk_usage', return_value=SimpleNamespace(free=8 * 1024 ** 3))
    def test_checkpoint_never_spends_the_final_reserve(self, _disk):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); site = root / 'site'; output = root / 'out'; site.mkdir(); output.mkdir()
            (site / 'a').write_bytes(b'x')
            with self.assertRaisesRegex(ValueError, '8 GiB free reserve'):
                module.checkpoint(site, output, {})
            self.assertEqual(list(output.iterdir()), [])

    def test_readback_rejects_duplicate_extra_link_and_missing_members(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'a'; source.write_bytes(b'x')
            expected = {'a': module.digest_file(source)}
            for mode in ['duplicate', 'extra', 'link', 'missing']:
                path = root / (mode + '.tar.gz')
                with tarfile.open(path, mode='w:gz') as archive:
                    names = ['site/a', 'site/a'] if mode == 'duplicate' else ['site/a', 'site/b'] if mode == 'extra' else [] if mode == 'missing' else ['site/a']
                    for name in names:
                        member = tarfile.TarInfo(name)
                        if mode == 'link':
                            member.type = tarfile.SYMTYPE; member.linkname = '/tmp/not-allowed'
                            archive.addfile(member)
                        else:
                            member.size = 1; archive.addfile(member, io.BytesIO(b'x'))
                with self.subTest(mode=mode), self.assertRaises(ValueError):
                    module.verify_checkpoint(path, expected)

    def test_same_supervisor_retains_ten_minute_upload_margin(self):
        self.assertEqual(module.SUPERVISOR.remaining_budget(100, 100), 95 * 60)
        self.assertEqual(module.SUPERVISOR.remaining_budget(100, 1300), 80 * 60)
        with self.assertRaises(ValueError):
            module.SUPERVISOR.remaining_budget(100, 6100)
        self.assertEqual(module.execution_budget(100, 100), 95 * 60 - 24)
        self.assertEqual(module.execution_budget(100, 1300), 80 * 60 - 24)
        for now in [6076, 6099]:
            with self.assertRaisesRegex(ValueError, 'process cleanup'):
                module.execution_budget(100, now)

    def test_report_collection_has_no_tree_or_unlisted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / 'run'; output.mkdir()
            (output / 'report.json').write_text('{"status":"failed"}')
            (output / 'private-unlisted.txt').write_text('not part of evidence')
            class Args:
                pass
            args = Args(); args.output = output; args.reports = root / 'reports'
            module.collect(args)
            self.assertEqual(set(path.name for path in args.reports.iterdir()), {'report.json', 'collection.json'})


if __name__ == '__main__':
    unittest.main()
