"""Finite-run and local process-restart barriers, with read-only GitHub fixtures."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from app.services.price_pilot_admission import (
    CAPTURE_WORKFLOW, CAPTURE_JOB, CAPTURE_STEP, REPOSITORY, REPOSITORY_ID, PILOT,
    consume_attempt, context_from_environment, check_current_attempt, terminal_record,
)
from app.services.bounded_price_recovery import encoded, sha


def inputs(root):
    approval={'controller_sha':'a'*40,'github_admission':{'repository':REPOSITORY,
        'workflow_path':CAPTURE_WORKFLOW,'workflow_id':70,'expected_run_number':1,
        'expected_run_attempt':1,'branch':'preview/approved-price-capture','review_status':'approved_finite_capture_run'}}
    env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':REPOSITORY,'GITHUB_EVENT_NAME':'workflow_dispatch',
        'GITHUB_REF':'refs/heads/preview/approved-price-capture','GITHUB_SHA':'a'*40,
        'GITHUB_RUN_NUMBER':'1','GITHUB_WORKFLOW_SHA':'a'*40,
        'GITHUB_WORKFLOW_REF':f'{REPOSITORY}/{CAPTURE_WORKFLOW}@refs/heads/preview/approved-price-capture',
        'GITHUB_RUN_ID':'100','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':CAPTURE_JOB,'RUNNER_TEMP':str(root)}
    return approval,env


class GitHubFixture:
    def __init__(self):
        self.run={'id':100,'run_number':1,'run_attempt':1,'workflow_id':70,'head_sha':'a'*40,
            'head_branch':'preview/approved-price-capture','path':CAPTURE_WORKFLOW,'event':'workflow_dispatch',
            'status':'in_progress','conclusion':None,'repository':{'id':REPOSITORY_ID,'full_name':REPOSITORY},
            'head_repository':{'id':REPOSITORY_ID,'full_name':REPOSITORY}}
        self.runs=[self.run]
        self.artifacts={100:[]}
        self.jobs=[{'id':80,'name':CAPTURE_JOB,'run_id':100,'head_sha':'a'*40,'run_attempt':1,'status':'in_progress','conclusion':None,
                    'runner_id':81,'steps':[{'name':CAPTURE_STEP,'number':5,'status':'in_progress','conclusion':None}]}]
        self.calls=[]
        self.incomplete=False
        self.branch='a'*40
        self.fail_second_read=False

    def __call__(self, endpoint):
        self.calls.append(endpoint)
        if self.fail_second_read and self.calls.count(f'repos/{REPOSITORY}/actions/runs/100')>1:
            raise OSError('simulated uncertain authority read')
        prefix=f'repos/{REPOSITORY}/'
        tail=endpoint.removeprefix(prefix)
        if tail=='actions/workflows/70': return {'id':70,'path':CAPTURE_WORKFLOW,'state':'active'}
        if tail.startswith('git/ref/heads/'):
            return {'ref':'refs/heads/preview/approved-price-capture','object':{'type':'commit','sha':self.branch}}
        if tail=='actions/workflows/70/runs?per_page=100':
            return {'total_count':len(self.runs)+int(self.incomplete),'workflow_runs':deepcopy(self.runs)}
        if tail.endswith('/jobs?per_page=100'):
            return {'total_count':len(self.jobs),'jobs':deepcopy(self.jobs)}
        if tail.endswith('/artifacts?per_page=100'):
            rows=self.artifacts[int(tail.split('/')[2])]
            return {'total_count':len(rows),'artifacts':deepcopy(rows)}
        if tail.startswith('actions/runs/'):
            run=next(r for r in self.runs if r['id']==int(tail.split('/')[2]))
            value=deepcopy(run)
            if '/attempts/' in tail: value['run_attempt']=int(tail.rsplit('/',1)[-1])
            return value
        raise AssertionError('Unexpected fixture API read: '+tail)


class PricePilotAdmissionTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.approval,self.env=inputs(self.root)
        self.api=GitHubFixture()

    def consume(self, **changes):
        return consume_attempt(self.approval,'b'*64,environment=self.env,api=self.api,
            clock=lambda:datetime(2026,10,6,19,tzinfo=timezone.utc),**changes)

    def test_first_exact_run_consumes_fixed_marker_and_terminal_cannot_reopen_it(self):
        claim=self.consume()
        marker=self.root/f'{PILOT}-consumed.json'
        before=marker.read_bytes()
        for reason in ('provider_denied_403','provider_denied_429','transport_or_capture_failure','cancelled',None):
            terminal=terminal_record(claim,{'stopped':reason,'request_count':1})
            self.assertFalse(terminal['admission_reusable'])
            with self.assertRaises(FileExistsError): self.consume()
            self.assertEqual(marker.read_bytes(),before)
        self.assertEqual(json.loads(before)['context']['run_attempt'],1)

    def test_fresh_python_process_output_and_redis_cannot_reuse_admission(self):
        self.consume()
        script='''
from pathlib import Path
from test_price_pilot_admission import inputs,GitHubFixture
from app.services.price_pilot_admission import consume_attempt
import sys
a,e=inputs(Path(sys.argv[1]))
e['PRICE_PILOT_OUTPUT']='a-new-output'
e['REDIS_HOST']='a-new-redis-instance'
try: consume_attempt(a,'c'*64,environment=e,api=GitHubFixture())
except FileExistsError: print('spent')
else: raise AssertionError('Fresh process reused a consumed admission')
'''
        env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[2])+os.pathsep+str(Path(__file__).parent)}
        value=subprocess.check_output([sys.executable,'-c',script,str(self.root)],env=env,text=True)
        self.assertEqual(value.strip(),'spent')

    def test_concurrent_same_job_claim_has_one_winner(self):
        def claim(_):
            try: self.consume();return 'claimed'
            except FileExistsError:return 'spent'
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(claim,range(4)))
        self.assertEqual(results.count('claimed'),1)
        self.assertEqual(results.count('spent'),3)

    def test_uncertain_reread_keeps_consumed_marker(self):
        self.api.fail_second_read=True
        with self.assertRaises(OSError):self.consume()
        self.api.fail_second_read=False
        with self.assertRaises(FileExistsError):self.consume()

    def test_rerun_attempt_or_new_run_cannot_reuse_exact_finite_admission(self):
        for key,value in [('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','push'),('GITHUB_REF','refs/heads/main'),
                          ('GITHUB_SHA','d'*40),('GITHUB_JOB','another-job'),('GITHUB_WORKFLOW_SHA','d'*40),
                          ('GITHUB_RUN_NUMBER','2'),('GITHUB_WORKFLOW_REF','another-workflow')]:
            env={**self.env,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):
                consume_attempt(self.approval,'b'*64,environment=env,api=self.api)
        self.api.run['run_number']=2
        with self.assertRaises(ValueError):self.consume()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_terminal_cancelled_and_failed_current_run_is_spent_without_marker(self):
        for outcome in ('cancelled','failure','success','timed_out'):
            self.api.run.update(status='completed',conclusion=outcome)
            with self.subTest(outcome=outcome),self.assertRaisesRegex(ValueError,'spent'):
                self.consume()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_prior_run_and_all_attempts_are_read_then_spent_even_without_artifact(self):
        old=deepcopy(self.api.run);old.update(id=99,run_number=1,run_attempt=2,status='completed',conclusion='cancelled')
        self.api.run['run_number']=2
        self.approval['github_admission']['expected_run_number']=2
        self.env['GITHUB_RUN_NUMBER']='2'
        self.api.runs=[old,self.api.run];self.api.artifacts[99]=[]
        with self.assertRaisesRegex(ValueError,'consumed/uncertain'):self.consume()
        self.assertTrue(any('/99/attempts/1' in call for call in self.api.calls))
        self.assertTrue(any('/99/attempts/2' in call for call in self.api.calls))
        self.assertTrue(any('/99/artifacts?' in call for call in self.api.calls))

    def test_missing_deleted_or_incomplete_history_fails_closed(self):
        self.api.incomplete=True
        with self.assertRaisesRegex(ValueError,'Incomplete'):self.consume()
        self.api.incomplete=False;self.api.run['run_number']=2
        self.approval['github_admission']['expected_run_number']=2
        self.env['GITHUB_RUN_NUMBER']='2'
        with self.assertRaisesRegex(ValueError,'missing/deleted'):self.consume()

    def test_existing_terminal_artifact_never_restores_admission(self):
        self.api.artifacts[100]=[{'id':200,'name':'price-pilot-terminal-100-1','expired':False,
            'digest':'sha256:'+'e'*64,'workflow_run':{'id':100,'head_sha':'a'*40}}]
        with self.assertRaisesRegex(ValueError,'already has terminal'):self.consume()
        self.api.artifacts[100][0]['expired']=True
        with self.assertRaisesRegex(ValueError,'expired'):self.consume()

    def test_stale_branch_foreign_repository_or_replaced_job_fails_closed(self):
        self.api.branch='c'*40
        with self.assertRaisesRegex(ValueError,'advanced'):self.consume()
        self.api.branch='a'*40;self.api.run['head_repository']['id']=999
        with self.assertRaises(ValueError):self.consume()
        self.api.run['head_repository']['id']=REPOSITORY_ID;self.api.jobs.append(deepcopy(self.api.jobs[0]))
        with self.assertRaisesRegex(ValueError,'duplicate'):self.consume()

    def test_acquisition_job_cannot_belong_to_another_run(self):
        self.api.jobs[0]['run_id']=101
        with self.assertRaisesRegex(ValueError,'job/step'):self.consume()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_acquisition_job_cannot_execute_a_different_head(self):
        self.api.jobs[0]['head_sha']='f'*40
        with self.assertRaisesRegex(ValueError,'job/step'):self.consume()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_same_name_recreated_repository_cannot_reuse_admission(self):
        for key in ('repository','head_repository'):
            self.api.run[key]['id']=REPOSITORY_ID+1
        with self.assertRaisesRegex(ValueError,'foreign'):self.consume()
        self.assertEqual(list(self.root.iterdir()),[])

    def test_capture_pending_and_local_cli_have_no_github_admission(self):
        self.approval['github_admission']['review_status']='pending_owner_review'
        with self.assertRaisesRegex(ValueError,'not approved'):self.consume()
        self.assertEqual(self.api.calls,[])
        self.approval['github_admission']['review_status']='approved_finite_capture_run'
        self.env['GITHUB_ACTIONS']='false'
        with self.assertRaisesRegex(ValueError,'workflow context'):self.consume()


if __name__=='__main__':unittest.main()
