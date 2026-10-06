"""Recorded synthetic responses only; no provider/network calls are permitted."""
from copy import deepcopy
from datetime import date, datetime, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.services.bounded_price_recovery import (
    CaptureTransport, PilotStopped, SYMBOLS, WRITEFUNC_ERROR, encoded, sha,
    epoch_midnight, exclusive_end, request_bounds, read_pinned_proposal,
    normalize_history, validate_history_join, verify_identity_record,
)
from app.scripts.bounded_price_recovery import (
    StrictSharedBudget, admit_captures, live_rate_gate, main, read_approval, vendor_download,
)

ROOT = Path(__file__).resolve().parents[3]
PROPOSAL_PATH = ROOT / 'docs/financial-source-evidence/four-symbol-price-recovery-proposal-2026-10-06.json'
APPROVAL_PATH = ROOT / 'docs/financial-source-evidence/four-symbol-price-pilot-admission-pending-2026-10-06.json'
FIXTURE = json.loads((ROOT / 'backend/tests/fixtures/bounded_price_pilot_transport.json').read_text())['responses']
NOW = datetime(2026, 10, 6, 18, tzinfo=timezone.utc)


class Response:
    def __init__(self, status, url):
        self.status_code, self.url = status, url
        self.content, self.history = b'', []

    @property
    def text(self):
        return self.content.decode()

    def json(self):
        return json.loads(self.content)


class RecordedTransport:
    def __init__(self):
        self.calls = []
        self.status = 200
        self.failure = None
        self.body = None

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if self.failure:
            raise self.failure
        if self.body is not None:
            raw = self.body
        elif '/chart/' in url:
            value = deepcopy(FIXTURE[url.rsplit('/', 1)[-1]])
            if kwargs['params'].get('range') == '1d':
                # Metadata discovery intentionally includes Oct6 intraday bars.
                value['chart']['result'][0]['timestamp'] = [epoch_midnight(date(2026, 10, 6)) + 34200]
            raw = encoded(value)
        else:
            raw = b'ephemeral-bootstrap-not-retained'
        answer = kwargs['content_callback'](raw)
        if answer == WRITEFUNC_ERROR:
            raise RuntimeError('synthetic callback transfer abort')
        return Response(self.status, url)


def history_request(symbol='ET'):
    first, end = request_bounds(symbol)
    return 'GET', f'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}', {
        'params': {'period1': first, 'period2': end, 'interval': '1d',
                   'includePrePost': False, 'events': 'div,splits,capitalGains', 'crumb': 'secret-never-recorded'}}


class BoundedTransportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.time = 0.
        self.cancel = False
        self.now = NOW
        self.guard = CaptureTransport(self.root / 'output', rate_gate=lambda guard: None,
            clock=lambda: self.now, monotonic=lambda: self.time, cancelled=lambda: self.cancel)
        self.send = RecordedTransport()

    def history(self, symbol='ET'):
        method, url, kwargs = history_request(symbol)
        return self.guard.request(self.send, method, url, **kwargs)

    def test_capture_is_immutable_bounded_and_redacts_bootstrap(self):
        self.guard.request(self.send, 'GET', 'https://fc.yahoo.com', allow_redirects=True)
        self.guard.request(self.send, 'GET', 'https://query1.finance.yahoo.com/v1/test/getcrumb')
        response = self.history()
        self.assertEqual(response.json(), FIXTURE['ET'])
        self.assertEqual(len(list((self.guard.output / 'raw').iterdir())), 1)
        text = b''.join(p.read_bytes() for p in self.guard.output.rglob('*.json'))
        self.assertNotIn(b'secret-never-recorded', text)
        self.assertNotIn(b'ephemeral-bootstrap-not-retained', text)
        for _, _, kwargs in self.send.calls:
            self.assertFalse(kwargs['allow_redirects'])
            self.assertEqual(kwargs['max_redirects'], 0)
            self.assertFalse(kwargs['stream'])
        with self.assertRaises(FileExistsError):
            CaptureTransport(self.guard.output, rate_gate=lambda _: None)

    def test_ten_request_envelope_includes_all_helpers_then_latches(self):
        self.guard.request(self.send, 'GET', 'https://fc.yahoo.com')
        self.guard.request(self.send, 'GET', 'https://query1.finance.yahoo.com/v1/test/getcrumb')
        for symbol in SYMBOLS:
            self.guard.request(self.send, 'GET', f'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}',
                params={'range': '1d', 'interval': '1d'})
            self.history(symbol)
        self.assertEqual(len(self.send.calls), 10)
        with self.assertRaisesRegex(PilotStopped, 'budget_exhausted'):
            self.history()
        self.assertEqual(len(self.send.calls), 10)

    def test_hidden_retry_same_request_is_blocked_before_egress(self):
        self.history()
        with self.assertRaisesRegex(PilotStopped, 'hidden_retry'):
            self.history()
        with self.assertRaises(PilotStopped):
            self.history('SUN')
        self.assertEqual(len(self.send.calls), 1)

    def test_denial_redirect_and_transport_errors_stop_all_later_calls(self):
        for status in (401, 403, 429, 301, 307, 404, 500):
            with self.subTest(status=status):
                self.guard = CaptureTransport(self.root / str(status), rate_gate=lambda _: None, clock=lambda: NOW)
                send = RecordedTransport(); send.status = status
                method, url, kwargs = history_request()
                with self.assertRaises(PilotStopped):
                    self.guard.request(send, method, url, **kwargs)
                with self.assertRaises(PilotStopped):
                    self.guard.request(send, *history_request('SUN')[:2], **history_request('SUN')[2])
                self.assertEqual(len(send.calls), 1)
                self.assertEqual(self.guard.receipts[0]['status_code'], status)
        self.guard = CaptureTransport(self.root / 'failure', rate_gate=lambda _: None, clock=lambda: NOW)
        send = RecordedTransport(); send.failure = TimeoutError('secret-url-must-not-appear')
        with self.assertRaisesRegex(PilotStopped, 'transport_or_capture_failure'):
            self.guard.request(send, *history_request()[:2], **history_request()[2])
        with self.assertRaises(PilotStopped):
            self.guard.request(send, *history_request('DDS')[:2], **history_request('DDS')[2])
        self.assertEqual(len(send.calls), 1)
        self.assertNotIn('secret-url', json.dumps(self.guard.receipts))

    def test_no_fallback_search_profile_post_or_unbounded_history(self):
        targets = [('POST', 'https://consent.yahoo.com/v2/collectConsent', {}),
                   ('GET', 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/ET', {}),
                   ('GET', 'https://example.com', {}),
                   ('GET', 'https://query2.finance.yahoo.com/v8/finance/chart/EQR', {}),
                   ('GET', 'https://query2.finance.yahoo.com/v8/finance/chart/ET', {'params': {'range': '2y'}})]
        for n, (method, url, kwargs) in enumerate(targets):
            guard = CaptureTransport(self.root / f'bad-{n}', rate_gate=lambda _: None, clock=lambda: NOW)
            with self.assertRaises(PilotStopped): guard.request(self.send, method, url, **kwargs)
        self.assertEqual(self.send.calls, [])

    def test_size_limit_returns_real_curl_abort_sentinel(self):
        self.send.body = b'a' * 9
        with patch('app.services.bounded_price_recovery.MAX_BODY', 8):
            with self.assertRaisesRegex(PilotStopped, 'response_size_budget'):
                self.history()
        self.assertEqual(self.guard.raw_bytes, 0)
        self.assertEqual(list((self.guard.output / 'raw').iterdir()), [])
        with self.assertRaises(PilotStopped): self.history('SUN')
        self.assertEqual(len(self.send.calls), 1)

    def test_total_raw_cap_stops_next_body(self):
        self.send.body = b'a' * 6
        with patch('app.services.bounded_price_recovery.MAX_RAW', 10):
            self.history()
            with self.assertRaisesRegex(PilotStopped, 'response_size_budget'):
                self.history('SUN')
        self.assertEqual(self.guard.raw_bytes, 6)

    def test_receipt_write_failure_latches_before_any_later_request(self):
        from app.services.bounded_price_recovery import immutable_write
        def fail_receipt(path, raw, maximum):
            if Path(path).parent.name == 'receipts': raise OSError('disk full')
            return immutable_write(path, raw, maximum)
        with patch('app.services.bounded_price_recovery.immutable_write', fail_receipt):
            with self.assertRaisesRegex(PilotStopped, 'receipt_capture_failed'): self.history()
        with self.assertRaises(PilotStopped): self.history('SUN')
        self.assertEqual(len(self.send.calls), 1)

    def test_cancel_before_call_and_mid_transfer_does_not_retry(self):
        self.cancel = True
        with self.assertRaisesRegex(PilotStopped, 'cancelled'): self.history()
        self.assertEqual(self.send.calls, [])
        class WaitingRedis:
            def ping(self): pass
            def eval(self, *args): return b'1'
        def cancel_sleep(seconds): self.cancel=True
        self.cancel = False
        waiting=CaptureTransport(self.root/'waiting',rate_gate=StrictSharedBudget(WaitingRedis(),[1]*4,sleep=cancel_sleep),
            clock=lambda:NOW,monotonic=lambda:self.time,cancelled=lambda:self.cancel)
        with self.assertRaisesRegex(PilotStopped,'cancelled'):
            waiting.request(self.send,*history_request()[:2],**history_request()[2])
        self.assertEqual(self.send.calls, [])
        guard = CaptureTransport(self.root / 'mid-cancel', rate_gate=lambda _: None, clock=lambda: NOW,
                                 cancelled=lambda: self.cancel)
        self.cancel = False
        def mid_transfer(method, url, **kwargs):
            self.cancel = True
            self.assertEqual(kwargs['content_callback'](b'body'), WRITEFUNC_ERROR)
            return Response(200, url)
        with self.assertRaisesRegex(PilotStopped, 'cancelled'):
            guard.request(mid_transfer, *history_request()[:2], **history_request()[2])

    def test_clock_midnight_rollback_and_wall_deadline_stop_before_next_request(self):
        self.history()
        self.now = datetime(2026, 10, 7, tzinfo=timezone.utc)
        with self.assertRaisesRegex(PilotStopped, 'capture_day'): self.history('SUN')
        self.assertEqual(len(self.send.calls), 1)
        for case in ('rollback', 'deadline'):
            guard = CaptureTransport(self.root / case, rate_gate=lambda _: None,
                clock=lambda: self.now, monotonic=lambda: self.time)
            self.now, self.time = NOW, 0.
            guard.check()
            if case == 'rollback': self.now = datetime(2026, 10, 6, 17, tzinfo=timezone.utc)
            else: self.time = 301.
            with self.assertRaises(PilotStopped): guard.check()

    def test_shared_controls_fail_closed_and_cancellation_during_wait(self):
        class Redis:
            def ping(self): pass
            def eval(self, *args): return b'-1'
        gate = StrictSharedBudget(Redis(), [1, 2, 2, 3])
        self.guard.rate_gate = gate
        with self.assertRaisesRegex(PilotStopped, 'shared_circuit'): self.history()
        self.assertEqual(self.send.calls, [])

    def test_circuit_opening_after_reservation_stops_before_transport(self):
        class Redis:
            def ping(self): pass
            def eval(self, *args): return b'0'
            def hget(self, *args): return b'open'
        self.guard.rate_gate=StrictSharedBudget(Redis(),[1,2,2,3])
        with self.assertRaisesRegex(PilotStopped,'open_after_wait'): self.history()
        self.assertEqual(self.send.calls,[])

    def test_disabled_static_site_redis_cannot_inherit_a_permissive_budget(self):
        with patch.dict('sys.modules', {'app.config':SimpleNamespace(settings=SimpleNamespace(redis_enabled=False))}):
            with self.assertRaisesRegex(ValueError,'unchanged Static Site'):
                live_rate_gate()
        class BrokenRedis:
            def ping(self): raise OSError('no connection')
        guard = CaptureTransport(self.root / 'broken-budget', rate_gate=StrictSharedBudget(BrokenRedis(), [1]*4), clock=lambda: NOW)
        with self.assertRaisesRegex(PilotStopped, 'control_unavailable'):
            guard.request(self.send, *history_request()[:2], **history_request()[2])
        self.assertEqual(self.send.calls, [])


class IdentityHistoryTests(unittest.TestCase):
    def setUp(self):
        self.proposal = read_pinned_proposal(PROPOSAL_PATH)
        self.approval = json.loads(APPROVAL_PATH.read_text())
        for r in self.approval['identity_records']:
            r['review_status'] = 'approved_for_price_identity_validation'
        self.transition = deepcopy(self.proposal['identity_transitions'][0])
        self.identity = deepcopy(self.approval['identity_records'][0])

    def bars(self, symbol='ET', body=None, transition=None, identity=None):
        return normalize_history(encoded(body or FIXTURE[symbol]), transition=transition or self.transition,
            identity=identity or self.identity, is_session=lambda d: d.weekday() < 5)

    def prior(self, bars):
        raw = encoded({'symbol': 'ET', 'as_of_date': '2026-10-02', 'bars': bars[:-1]})
        self.transition['retained_chart_sha256'] = sha(raw)
        return raw

    def test_good_overlap_keeps_history_and_current_clock_separate(self):
        bars = self.bars(); prior = self.prior(bars)
        self.assertEqual(validate_history_join('ET', bars, prior, self.transition), bars)
        self.assertEqual(bars[-1]['date'], '2026-10-05')

    def test_exclusive_end_uses_new_york_midnight_including_dst(self):
        self.assertEqual(exclusive_end(date(2026, 10, 5)), 1791259200)
        # These civil-day spans include the DST change; never add fixed 86400.
        self.assertEqual(epoch_midnight(date(2026, 3, 9))-epoch_midnight(date(2026, 3, 8)), 23*3600)
        self.assertEqual(epoch_midnight(date(2026, 11, 2))-epoch_midnight(date(2026, 11, 1)), 25*3600)

    def test_oct6_midnight_and_intraday_cannot_enter_bars(self):
        for stamp in (exclusive_end(date(2026, 10, 5)), exclusive_end(date(2026, 10, 5))+34200):
            body = deepcopy(FIXTURE['ET']); body['chart']['result'][0]['timestamp'][-1] = stamp
            with self.assertRaisesRegex(ValueError, 'exclusive request'): self.bars(body=body)

    def test_non_session_duplicates_missing_close_and_nan_rejected(self):
        for mutation in ('weekend', 'duplicate', 'stale', 'nan'):
            body = deepcopy(FIXTURE['ET']); row = body['chart']['result'][0]
            if mutation == 'weekend': row['timestamp'][-1] = epoch_midnight(date(2026,10,4))+34200
            elif mutation == 'duplicate': row['timestamp'][-1] = row['timestamp'][-2]
            elif mutation == 'stale':
                row['timestamp'].pop()
                for value in row['indicators']['quote'][0].values(): value.pop()
            else: row['indicators']['quote'][0]['close'][-1] = None
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): self.bars(body=body)

    def test_exchange_calendar_closed_day_is_not_accepted_by_weekday(self):
        with self.assertRaisesRegex(ValueError,'non-session'):
            normalize_history(encoded(FIXTURE['ET']),transition=self.transition,identity=self.identity,
                is_session=lambda d:d!=date(2026,9,30))

    def test_issuer_class_mapping_and_provider_identifier_mismatch_rejected(self):
        for field, value in [('official_identifiers', {'cik':'0000000001'}), ('instrument_classes',['Preferred stock']),
                             ('review_status','pending_owner_review'), ('prior_symbol','SUNC'), ('target_mic','XNYS')]:
            identity = deepcopy(self.identity); identity[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): self.bars(identity=identity)
        for field, value in [('symbol','OTHER'),('currency','CAD'),('instrumentType','ETF'),('exchangeName','NYQ'),('dataGranularity','1m'),
                             ('longName','Unrelated company'),('cik','0000000001')]:
            body=deepcopy(FIXTURE['ET']); body['chart']['result'][0]['meta'][field]=value
            with self.subTest(field=field), self.assertRaises(ValueError): self.bars(body=body)

    def test_split_or_changed_overlap_never_invents_adjustment_or_refetches(self):
        bars = self.bars(); prior = self.prior(bars)
        for field, value in [('close',50), ('open',100.01), ('volume',1001)]:
            changed=deepcopy(bars); changed[1][field]=value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_history_join('ET',changed,prior,self.transition)
        with self.assertRaisesRegex(ValueError,'Overlap'):
            validate_history_join('ET',bars[-1:],prior,self.transition)

    def test_vmrk_has_no_legacy_chart_scalar_splice_and_short_history_stays_short(self):
        transition=self.proposal['identity_transitions'][3]; identity=self.approval['identity_records'][3]
        bars=self.bars('VMRK',transition=transition,identity=identity)
        self.assertEqual(len(validate_history_join('VMRK',bars,None,transition)),5)
        with self.assertRaisesRegex(ValueError,'legacy'):
            validate_history_join('VMRK',bars,encoded({'close':63.66}),transition)

    def test_default_cli_is_offline_and_execution_needs_separate_approval(self):
        with patch('app.scripts.bounded_price_recovery.prior_charts',return_value={'ET':b'', 'SUN':b'', 'DDS':b''}), \
             patch('app.scripts.bounded_price_recovery.live_rate_gate',side_effect=AssertionError('No network controls in admission')), \
             patch('app.scripts.bounded_price_recovery.vendor_download',side_effect=AssertionError('Provider must not run')):
            arguments=['--proposal',str(PROPOSAL_PATH),'--admission',str(APPROVAL_PATH),
                '--admission-sha256',sha(APPROVAL_PATH.read_bytes()),'--prior-release','unused','--output','unused']
            self.assertEqual(main(arguments),0)
            for suffix in ([],['--execute']):
                with self.assertRaises(SystemExit): main(['run',*arguments,*suffix])

    def test_approval_hash_and_bool_cannot_be_spoofed(self):
        with self.assertRaisesRegex(ValueError,'hash changed'):
            read_approval(APPROVAL_PATH,'0'*64,self.proposal)

    def test_unreceipted_cache_and_mutated_raw_cannot_be_reobserved(self):
        with tempfile.TemporaryDirectory() as folder:
            guard=CaptureTransport(Path(folder)/'run',rate_gate=lambda _:None,clock=lambda:NOW)
            result=admit_captures(guard,self.proposal,self.approval,{},lambda d:True)
            self.assertTrue(all(r['status']=='quarantined' for r in result))
            send=RecordedTransport()
            guard.request(send,*history_request()[:2],**history_request()[2])
            (guard.output/guard.receipts[0]['raw_path']).write_bytes(b'changed')
            result=admit_captures(guard,self.proposal,self.approval,{},lambda d:True)
            self.assertIn('changed before replay',result[0]['reason'])
            self.assertEqual(list(guard.output.glob('observation-*')),[])


class VendorRecordedReplayTests(unittest.TestCase):
    def test_real_pinned_yfinance_path_only_uses_ten_guarded_recorded_requests(self):
        import yfinance as yf
        from yfinance import cache
        from yfinance.data import YfData
        from curl_cffi import requests
        from curl_cffi.curl import CURL_WRITEFUNC_ERROR
        self.assertEqual(WRITEFUNC_ERROR,CURL_WRITEFUNC_ERROR)
        proposal=read_pinned_proposal(PROPOSAL_PATH)
        send=RecordedTransport()
        with tempfile.TemporaryDirectory() as folder:
            guard=CaptureTransport(Path(folder)/'run',rate_gate=lambda _:None,clock=lambda:NOW)
            def recorded(session, method, url, **kwargs):
                if url == 'https://fc.yahoo.com':
                    from http.cookiejar import Cookie
                    session.cookies.jar.set_cookie(Cookie(0,'A3','synthetic-cookie',None,False,'.yahoo.com',True,True,'/',True,True,1893456000,False,None,None,{}))
                return send(method,url,**kwargs)
            with patch.object(requests.Session,'_request_once',recorded), \
                 patch.dict(type(YfData)._instances,{},clear=True), \
                 patch.dict('sys.modules',{'app.config':SimpleNamespace(settings=SimpleNamespace(yfinance_curl_cffi_impersonate='chrome'))}), \
                 patch.object(cache,'get_cookie_cache'),patch.object(cache,'get_tz_cache'):
                vendor_download(guard,proposal)
            self.assertIsNone(guard.stopped)
            self.assertEqual(len(send.calls),10)
            self.assertEqual(sum(r['role']=='history' for r in guard.receipts),4)
            self.assertEqual(sum(r['role']=='metadata_only' for r in guard.receipts),4)
            self.assertEqual(len(list(guard.output.rglob('*.db'))),0)
            # Metadata payload really has Oct6 timestamps and remains isolated.
            for receipt in guard.receipts:
                if receipt['role']=='metadata_only':
                    raw=json.loads((guard.output/receipt['raw_path']).read_bytes())
                    self.assertGreaterEqual(raw['chart']['result'][0]['timestamp'][0],exclusive_end(date(2026,10,5)))
            approval=json.loads(APPROVAL_PATH.read_text())
            charts={}
            for transition, identity in zip(proposal['identity_transitions'], approval['identity_records']):
                identity['review_status']='approved_for_price_identity_validation'
                symbol=transition['proposed_provider_symbol']
                if symbol=='VMRK': continue
                bars=normalize_history(encoded(FIXTURE[symbol]),transition=transition,identity=identity,is_session=lambda d:d.weekday()<5)
                prior=encoded({'symbol':symbol,'as_of_date':'2026-10-02','bars':bars[:-1]})
                transition['retained_chart_sha256']=sha(prior);charts[symbol]=prior
            results=admit_captures(guard,proposal,approval,charts,lambda d:d.weekday()<5)
            self.assertEqual([r['status'] for r in results],['validated_local_observation']*4)
            for result in results:
                observed=json.loads((guard.output/result['path']).read_bytes())
                self.assertEqual(observed['observed_at'],NOW.isoformat())
                self.assertEqual(observed['bars'][-1]['date'],'2026-10-05')
                self.assertFalse(observed['technical_history_252_available'])
                self.assertFalse(observed['financial_identity_reassigned'])
                self.assertFalse(observed['publication_authority'])
            report=guard.finish({'observations':results})
            self.assertFalse(report['publication_authority'])

    def test_real_vendor_catches_denial_but_cannot_make_fallback_request(self):
        from yfinance import cache
        from yfinance.data import YfData
        from curl_cffi import requests
        send=RecordedTransport(); send.status=403
        with tempfile.TemporaryDirectory() as folder:
            guard=CaptureTransport(Path(folder)/'run',rate_gate=lambda _:None,clock=lambda:NOW)
            def recorded(session,method,url,**kwargs): return send(method,url,**kwargs)
            with patch.object(requests.Session,'_request_once',recorded), patch.dict(type(YfData)._instances,{},clear=True), \
                 patch.dict('sys.modules',{'app.config':SimpleNamespace(settings=SimpleNamespace(yfinance_curl_cffi_impersonate='chrome'))}), \
                 patch.object(cache,'get_cookie_cache'),patch.object(cache,'get_tz_cache'):
                with self.assertRaisesRegex(PilotStopped,'provider_denied_403'):
                    vendor_download(guard,read_pinned_proposal(PROPOSAL_PATH))
            self.assertEqual(len(send.calls),1)


if __name__=='__main__': unittest.main()
