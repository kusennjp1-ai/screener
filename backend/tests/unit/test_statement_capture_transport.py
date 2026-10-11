"""Synthetic-only adapter tests: no Curl.perform, DNS, HTTP, or provider I/O.

The real pinned native handles accept the FINAL options and PREREQ bridge, but
perform is replaced before any session exists. Separately reviewed loopback
integration proves the native seam; this suite does not claim wire observation.
"""
from __future__ import annotations

from collections import Counter
import importlib.util
import json
from pathlib import Path
import threading
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from curl_cffi import Curl, CurlOpt, requests
from curl_cffi._wrapper import ffi
import curl_cffi._wrapper as wrapper

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("statement_capture_transport", ROOT / ".github/scripts/statement-capture-transport.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
SERIES = ("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL"
          "?symbol=AAPL&type=quarterlyTotalRevenue&period1=1483142400&period2=1791676800")


@pytest.fixture(autouse=True)
def no_network_and_clean_environment(monkeypatch):
    for key in list(transport.os.environ):
        if key.upper() in transport._ENV_DENY or key.upper().startswith("CURL_"):
            monkeypatch.delenv(key)

    def forbidden(*args, **kwargs):
        raise AssertionError("No native perform is authorized in this synthetic suite")

    monkeypatch.setattr(Curl, "perform", forbidden)


def policy(**changes):
    events = []
    settings = dict(symbols=["AAPL", "MSFT"], deadline_monotonic=time.monotonic() + 3600,
                    boundary_check=lambda: None, retention_check=lambda: None, record=events.append)
    settings.update(changes)
    result = transport.TransportPolicy(**settings)
    return result, events


@pytest.fixture
def synthetic(monkeypatch):
    state = SimpleNamespace(callbacks={}, handles=[], options={}, calls=[], close_calls=[],
                            status=200, callbacks_per_perform=1, hook_failure=False,
                            invoke_hook=True, perform_error=None, response_cookie=False, response_factory=None)
    native_lib = wrapper.lib
    original_setopt, original_close = Curl.setopt, Curl.close

    class Bridge:
        def __getattr__(self, name):
            return getattr(native_lib, name)

        def _curl_easy_setopt(self, handle, option, value):
            key = int(ffi.cast("uintptr_t", handle))
            if int(option) == 20312:
                if state.hook_failure:
                    return 48
                state.callbacks[key] = ffi.cast("int(*)(void *, char *, char *, int, int)", value)
                state.handles.append(key)
            return native_lib._curl_easy_setopt(handle, option, value)

    def setopt(curl, option, value):
        # Track Python-issued final options after utility/impersonation.
        key = id(curl)
        state.options.setdefault(key, {})[option] = value
        if option == CurlOpt.URL:
            curl._synthetic_url = value.decode() if isinstance(value, bytes) else value
        return original_setopt(curl, option, value)

    def perform(curl, *args, **kwargs):
        key = int(ffi.cast("uintptr_t", curl._curl))
        state.calls.append(curl)
        if state.invoke_hook:
            for _ in range(state.callbacks_per_perform):
                value = state.callbacks[key](ffi.NULL, ffi.NULL, ffi.NULL, 443, 0)
                if value != 0:
                    raise RuntimeError("synthetic native abort")
        if state.perform_error:
            raise state.perform_error

    def parse(session, curl, buffer, headers, encoding, discard):
        response = requests.Response(curl)
        response.status_code = state.status
        response.http_version = 2
        response.primary_port = 443
        response.url = curl._synthetic_url
        response.redirect_count = 0
        response.history = []
        response.content = b"{}"
        if state.response_cookie:
            session.cookies.set("A3", "synthetic-cookie-secret", domain=".yahoo.com", path="/")
        if state.response_factory is not None:
            return state.response_factory(session, curl, response)
        return response

    def close(curl):
        if curl._curl is not None:
            state.close_calls.append(id(curl))
        return original_close(curl)

    monkeypatch.setattr(wrapper, "lib", Bridge())
    monkeypatch.setattr(Curl, "setopt", setopt)
    monkeypatch.setattr(Curl, "perform", perform)
    monkeypatch.setattr(Curl, "close", close)
    monkeypatch.setattr(requests.Session, "_parse_response", parse)
    return state


def session(p):
    return p.session_class(requests)(impersonate="chrome")


def test_constructor_defers_boundary_to_session():
    calls = []
    p, _ = policy(boundary_check=lambda: calls.append("boundary"))
    assert calls == []
    cls = p.session_class(requests)
    assert calls == []
    s = cls()
    assert calls == ["boundary"]
    s.close()


def test_yfinance_accepts_real_session_subclass():
    from yfinance.data import YfData
    p, _ = policy()
    s = session(p)
    data = object.__new__(YfData)
    data._cookie_lock = threading.Lock()
    data._proxy = None
    data._set_session(s)
    assert data._session is s
    s.close()


def test_get_has_one_pre_http_reservation_and_fresh_handle(synthetic):
    p, events = policy()
    s = session(p)
    assert s.get(SERIES).status_code == 200
    assert s.get(SERIES).status_code == 200
    assert p.native_admissions == 2 and p.fatal is None
    assert [e["sequence"] for e in events if e["kind"] == "native_admission_reserved"] == [1, 2]
    assert [e["sequence"] for e in events if e["kind"] == "native_response_observed"] == [1, 2]
    assert p.audit_record()["responses_observed"] == 2
    assert p.audit_record()["http_status_counts"] == {"200": 2}
    assert len(synthetic.calls) == len(synthetic.close_calls) == 2
    assert synthetic.calls[0] is not synthetic.calls[1]
    assert all(c._curl is None for c in synthetic.calls)
    assert "not_observed_wire" in p.audit_record()["count_semantics"]
    s.close()


def test_final_native_options_override_impersonation_and_yfinance_redirect(synthetic, monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://must-never-be-used.invalid:8080")
    p, _ = policy()
    s = session(p)
    s.get("https://fc.yahoo.com", allow_redirects=True)
    options = synthetic.options[id(synthetic.calls[0])]
    expected = {CurlOpt.PROXY: b"", CurlOpt.PRE_PROXY: b"", CurlOpt.NOPROXY: b"*",
                CurlOpt.FOLLOWLOCATION: 0, CurlOpt.MAXREDIRS: 0, CurlOpt.HTTP_VERSION: 2,
                CurlOpt.FRESH_CONNECT: 1, CurlOpt.FORBID_REUSE: 1,
                CurlOpt.SSL_VERIFYPEER: 1, CurlOpt.SSL_VERIFYHOST: 2, CurlOpt.TLS_KEY_USAGE_NO_CHECK: 0,
                CurlOpt.SSL_OPTIONS: 0, CurlOpt.SSL_SESSIONID_CACHE: 0,
                CurlOpt.SSL_ENABLE_TICKET: 0, CurlOpt.HTTPAUTH: 0,
                CurlOpt.PROXYAUTH: 0, CurlOpt.NETRC: 0, CurlOpt.HSTS_CTRL: 0,
                CurlOpt.PROTOCOLS_STR: b"https", CurlOpt.REDIR_PROTOCOLS_STR: b"https"}
    assert all(options[key] == value for key, value in expected.items())
    assert CurlOpt.ALTSVC not in options and CurlOpt.ALTSVC_CTRL not in options
    s.close()


@pytest.mark.parametrize("url", [
    "http://fc.yahoo.com", "https://fc.yahoo.com:444", "https://u:p@fc.yahoo.com",
    "https://fc.yahoo.com/#fragment", "https://fc.yahoo.com/#", "https://fc.yahoo.com/other",
    "https://FC.yahoo.com", "https://fc.yahoo.com.", "https://fc.yahoo.com\\@evil.invalid/",
    "https://fc.yahoo.com/\r\n", "https://fc.yahoo.com/?a=1",
    "https://query1.finance.yahoo.com/v1/test/getcrumb/", "https://query2.finance.yahoo.com/v1/test/getcrumb",
    "https://consent.yahoo.com/", "https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL",
    SERIES.replace("timeseries/AAPL", "timeseries/TSLA"), SERIES.replace("timeseries/AAPL", "timeseries/%41APL"),
    SERIES.replace("symbol=AAPL", "symbol=MSFT"), SERIES + "&symbol=AAPL", SERIES + "&bad=x",
    SERIES + "&crumb=abc%0Ddef", SERIES.replace("quarterlyTotalRevenue", "trailingTotalRevenue"),
])
def test_closed_route_rejection_before_perform(url, synthetic):
    p, _ = policy()
    with pytest.raises(transport.TransportStopped):
        session(p).get(url)
    assert not synthetic.calls and p.native_admissions == 0 and p.fatal


@pytest.mark.parametrize("kwargs", [
    {"headers": {"Host": "evil.invalid"}}, {"headers": {"Authorization": "secret"}},
    {"headers": {"Proxy-Authorization": "secret"}}, {"data": b"body"}, {"content": b"body"},
    {"json": {}}, {"files": {}}, {"auth": ("user", "password")}, {"proxy": "http://proxy"},
    {"proxies": {}}, {"proxy_auth": ("user", "password")}, {"verify": False},
    {"cert": "certificate"}, {"impersonate": "firefox"}, {"doh_url": "https://doh.invalid"},
    {"curl_options": {}}, {"stream": True}, {"interface": "127.0.0.1"},
    {"cookies": {"A3": "old"}}, {"timeout": None}, {"timeout": 0}, {"timeout": float("inf")},
])
def test_unreviewed_per_call_options_rejected(kwargs, synthetic):
    p, _ = policy()
    with pytest.raises(transport.TransportStopped):
        session(p).get(SERIES, **kwargs)
    assert not synthetic.calls and p.fatal


@pytest.mark.parametrize("kwargs", [
    {"auth": ("u", "p")}, {"headers": {"Host": "bad"}}, {"verify": False},
    {"cookies": {"A3": "old"}}, {"curl_options": {}}, {"thread": "gevent"},
    {"use_thread_local_curl": True}, {"retry": 0}, {"proxies": {}}, {"base_url": "https://fc.yahoo.com"},
])
def test_unreviewed_session_options_rejected(kwargs):
    p, _ = policy()
    with pytest.raises(transport.TransportStopped):
        p.session_class(requests)(**kwargs)
    assert p.fatal == "session_options_forbidden"


@pytest.mark.parametrize("attribute,value", [
    ("auth", ("u", "p")), ("verify", False), ("headers", {"Host": "bad"}),
    ("curl_options", {1: 2}), ("proxies", {"all": "bad"}), ("allow_redirects", True),
    ("_thread", "gevent"), ("doh_url", "https://doh.invalid"), ("http_version", 3),
    ("cert", "bad"), ("base_url", "https://bad.invalid"),
])
def test_session_mutation_fails_closed(attribute, value, synthetic):
    p, _ = policy()
    s = session(p)
    setattr(s, attribute, value)
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.fatal == "session_mutation" and not synthetic.calls


@pytest.mark.parametrize("key", sorted(transport._ENV_DENY | {"CURL_UNKNOWN_OVERRIDE"}))
def test_environment_override_before_creation_is_fatal(key, monkeypatch):
    monkeypatch.setenv(key, "")
    with pytest.raises(transport.TransportStopped, match="environment_override"):
        policy()


def test_environment_change_after_construction_is_fatal(synthetic, monkeypatch):
    p, _ = policy()
    s = session(p)
    monkeypatch.setenv("SSLKEYLOGFILE", "not-written")
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.fatal == "environment_override" and not synthetic.calls


def test_second_native_admission_aborts_no_second_reservation(synthetic):
    synthetic.callbacks_per_perform = 2
    p, events = policy()
    with pytest.raises(transport.TransportStopped):
        session(p).get(SERIES)
    assert p.native_admissions == 1 and p.fatal == "native_second_admission"
    assert [e["kind"] for e in events] == ["native_admission_reserved", "transport_stopped"]


def test_exact_thousand_job_wide_budget_and_no_refund():
    p, events = policy()
    for _ in range(1000):
        callback = p._native_callback(None, {"route": "anonymous_cookie"}, {"admitted": False})
        assert callback(None, None, None, 443, 0) == 0
    assert p.native_admissions == 1000
    callback = p._native_callback(None, {"route": "anonymous_cookie"}, {"admitted": False})
    assert callback(None, None, None, 443, 0) == 1
    assert p.native_admissions == 1000 and p.fatal == "native_budget_exhausted"
    assert len(events) == 1001


@pytest.mark.parametrize("which", ["record", "boundary", "retention"])
def test_callback_exception_aborts_and_latches(which):
    fail = {"on": False}
    events = []
    def check():
        if fail["on"]:
            raise KeyboardInterrupt("secret raw credential MUST NOT APPEAR")
    def record(event):
        events.append(event)
        if which == "record":
            raise KeyboardInterrupt("secret raw credential MUST NOT APPEAR")
    p, _ = policy(boundary_check=check if which == "boundary" else lambda: None,
                  retention_check=check if which == "retention" else lambda: None, record=record)
    fail["on"] = True
    callback = p._native_callback(None, {"route": "anonymous_cookie"}, {"admitted": False})
    assert callback(None, None, None, 443, 0) == 1 and p.fatal
    assert p.native_admissions == (1 if which == "record" else 0)
    assert "secret" not in json.dumps(events + [p.audit_record()])


def test_reservation_persistence_precedes_post_write_clock_and_mutation_checks():
    trace = []
    denied = {"value": False}
    def check():
        trace.append("check")
        return not denied["value"]
    def record(event):
        trace.append(event["kind"])
        denied["value"] = True
    p, _ = policy(boundary_check=check, record=record)
    callback = p._native_callback(None, {"route": "anonymous_cookie"}, {"admitted": False})
    assert callback(None, None, None, 443, 0) == 1
    assert trace[:3] == ["check", "native_admission_reserved", "check"]
    assert p.native_admissions == 1 and p.fatal == "boundary_denied"


@pytest.mark.parametrize("status", [301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 417, 429, 500, 503])
def test_non_success_raises_before_yfinance_can_retry(status, synthetic):
    synthetic.status = status
    p, _ = policy()
    s = session(p)
    with pytest.raises(transport.TransportStopped, match="redirect_forbidden" if status < 400 else str(status)):
        s.get(SERIES)
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.native_admissions == 1 and len(synthetic.calls) == 1


def test_only_cookie_bootstrap_404_is_expected(synthetic):
    synthetic.status = 404
    p, _ = policy()
    assert session(p).get("https://fc.yahoo.com").status_code == 404
    assert p.fatal is None


def test_hook_installation_failure_never_performs(synthetic):
    synthetic.hook_failure = True
    p, _ = policy()
    with pytest.raises(transport.TransportStopped):
        session(p).get(SERIES)
    assert p.fatal == "native_hook_installation" and not synthetic.calls


def test_missing_hook_invocation_is_fatal(synthetic):
    synthetic.invoke_hook = False
    p, _ = policy()
    with pytest.raises(transport.TransportStopped):
        session(p).get(SERIES)
    assert p.fatal == "native_hook_not_invoked" and p.native_admissions == 0


def test_transport_exception_never_refunds_and_sanitizes(synthetic):
    synthetic.perform_error = RuntimeError("cookie=private-secret crumb=private-secret")
    p, events = policy()
    with pytest.raises(transport.TransportStopped) as error:
        session(p).get(SERIES, params={"crumb": "private-secret"})
    assert p.native_admissions == 1
    assert "private-secret" not in str(error.value) + json.dumps(events + [p.audit_record()])
    assert len(synthetic.close_calls) == 1


def test_cookie_only_transient_from_owned_responses(synthetic):
    synthetic.response_cookie = True
    p, events = policy()
    s = session(p)
    s.get("https://fc.yahoo.com")
    s.get(SERIES, params={"crumb": "synthetic-crumb-secret"})
    assert p.native_admissions == 2
    assert "secret" not in json.dumps(events + [p.audit_record()])
    s.cookies.set("other", "injected", domain=".yahoo.com")
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.fatal == "cookie_mutation"
    s.close()
    assert len(s.cookies) == 0


def test_expired_deadline_and_other_thread_abort():
    p, _ = policy()
    callback = p._native_callback(None, {"route": "anonymous_cookie"}, {"admitted": False})
    result = []
    worker = threading.Thread(target=lambda: result.append(callback(None, None, None, 443, 0)))
    worker.start()
    worker.join()
    assert result == [1] and p.fatal == "thread_forbidden" and p.native_admissions == 0
    with pytest.raises(transport.TransportStopped, match="deadline_exhausted"):
        policy(deadline_monotonic=time.monotonic() - 1)


def test_exact_native_and_python_identity_verified_without_network():
    assert Path(transport._runtime_identity()).is_file()
    assert transport.NATIVE_SHA256 == "79c9faa1630b25a5c0b7bd3d8fd19356fb3e98aa7ebf594a8fe3809ac65b75f0"


def test_real_yfinance_both_income_getters_use_only_owned_session(synthetic, monkeypatch, tmp_path):
    """Real pinned getters/cache plumbing; only native perform/parser are synthetic."""
    import yfinance as yf
    import yfinance.cache as cache
    from yfinance.data import SingletonMeta
    from urllib.parse import parse_qs

    p, events = policy()
    s = session(p)
    # This test substitutes isolated global containers and restores prior ones;
    # production runner instead requires an already clean fresh subprocess.
    monkeypatch.setattr(SingletonMeta, "_instances", {})
    managers = [cache._TzDBManager, cache._CookieDBManager, cache._ISINDBManager]
    for manager in managers:
        monkeypatch.setattr(manager, "_db", None)
        monkeypatch.setattr(manager, "_cache_dir", str(tmp_path / "owned-yfinance"))
    for name, attr in (("_TzCacheManager", "_tz_cache"),
                       ("_CookieCacheManager", "_Cookie_cache"),
                       ("_ISINCacheManager", "_isin_cache")):
        manager = getattr(cache, name)
        assert hasattr(manager, attr)
        monkeypatch.setattr(manager, attr, None)
    cache.set_cache_location(str(tmp_path / "owned-yfinance"))
    logger = yf.utils.get_yf_logger()
    monkeypatch.setattr(logger, "disabled", True)
    defaults = []

    def forbid_default_session(*args, **kwargs):
        defaults.append(True)
        raise AssertionError("A default yfinance session would escape the owned boundary")

    monkeypatch.setattr(requests, "Session", forbid_default_session)

    def response_factory(owned, curl, response):
        url = urlsplit(curl._synthetic_url)
        if url.hostname == "fc.yahoo.com":
            response.status_code = 404
            owned.cookies.set("A3", "synthetic-only-cookie", domain=".yahoo.com", path="/")
            for cookie in owned.cookies.jar:
                cookie.expires = int(time.time()) + 3600
        elif url.hostname == "query1.finance.yahoo.com":
            response.content = b"synthetic-only-crumb"
        else:
            fields = parse_qs(url.query)["type"][0].split(",")
            name = "quarterlyTotalRevenue" if fields[0].startswith("quarterly") else "annualTotalRevenue"
            response.content = json.dumps({"timeseries": {"result": [{
                "meta": {"symbol": ["AAPL"]}, "timestamp": [1704067200], name: [
                    {"asOfDate": "2024-01-01", "reportedValue": {"raw": 100.0}}]}]}}).encode()
        return response

    synthetic.response_factory = response_factory
    try:
        ticker = yf.Ticker("AAPL", session=s)
        quarterly = ticker.quarterly_income_stmt
        annual = ticker.income_stmt
        assert not quarterly.empty and not annual.empty
        assert quarterly.loc["Total Revenue"].iloc[0] == annual.loc["Total Revenue"].iloc[0] == 100.0
        hosts = Counter(urlsplit(curl._synthetic_url).hostname for curl in synthetic.calls)
        assert hosts == {"fc.yahoo.com": 1, "query1.finance.yahoo.com": 1, "query2.finance.yahoo.com": 2}
        assert not defaults and p.native_admissions == 4 and p.fatal is None
        assert p.audit_record()["http_status_counts"] == {"404": 1, "200": 3}
        assert len([e for e in events if e["kind"] == "native_response_observed"]) == 4
        assert "synthetic-only" not in json.dumps(events + [p.audit_record()])
    finally:
        s.close()
        for manager in managers:
            if manager._db is not None:
                manager._db.close()
                manager._db = None


def test_malformed_session_mutation_is_sanitized_and_latched(synthetic):
    p, _ = policy()
    s = session(p)
    s.retry = None
    with pytest.raises(transport.TransportStopped, match="session_mutation"):
        s.get(SERIES)
    assert p.fatal == "session_mutation" and not synthetic.calls


def test_closed_session_is_fail_closed(synthetic):
    p, _ = policy()
    s = session(p)
    s.close()
    with pytest.raises(transport.TransportStopped, match="session_closed"):
        s.get(SERIES)
    assert not synthetic.calls


def test_all_other_methods_are_rejected(synthetic):
    for method in ("POST", "HEAD", "PUT", "DELETE", "OPTIONS", "get"):
        p, _ = policy()
        with pytest.raises(transport.TransportStopped):
            session(p).request(method, "https://fc.yahoo.com/")
    assert not synthetic.calls


def test_runtime_identity_failure_latches_without_native_setup(monkeypatch, synthetic):
    p, _ = policy()
    s = session(p)
    def mismatch():
        raise transport.TransportStopped("Strict transport stopped: runtime_identity")
    monkeypatch.setattr(transport, "_runtime_identity", mismatch)
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.fatal == "native_setup_or_transport_failure" and not synthetic.calls


def test_native_option_failure_latches_before_perform(monkeypatch, synthetic):
    p, _ = policy()
    s = session(p)
    setopt = Curl.setopt
    def fail(curl, option, value):
        if option == CurlOpt.SSL_ENABLE_TICKET:
            return 48
        return setopt(curl, option, value)
    monkeypatch.setattr(Curl, "setopt", fail)
    with pytest.raises(transport.TransportStopped):
        s.get(SERIES)
    assert p.fatal == "native_setup_or_transport_failure" and not synthetic.calls


def test_response_receipt_failure_latches_after_nonrefundable_admission(synthetic):
    records = []
    def record(event):
        records.append(event)
        if event["kind"] == "native_response_observed":
            raise OSError("sensitive filesystem detail")
    p, _ = policy(record=record)
    with pytest.raises(transport.TransportStopped) as error:
        session(p).get(SERIES)
    assert p.native_admissions == 1 and p.audit_record()["responses_observed"] == 1
    assert p.fatal == "native_setup_or_transport_failure"
    assert "sensitive" not in str(error.value) + json.dumps(p.audit_record())


def test_http_status_exception_matches_inherited_collector_regex(synthetic):
    import re
    for status in (403, 429):
        synthetic.status = status
        p, _ = policy()
        with pytest.raises(transport.TransportStopped) as error:
            session(p).get(SERIES)
        assert re.search(r"\b(403|429)\b", str(error.value)).group(1) == str(status)


def test_callback_reference_survives_gc_until_handle_close(synthetic, monkeypatch):
    import gc
    original = Curl.perform
    def collecting_perform(curl, *args, **kwargs):
        gc.collect()
        return original(curl, *args, **kwargs)
    monkeypatch.setattr(Curl, "perform", collecting_perform)
    p, _ = policy()
    assert session(p).get(SERIES).status_code == 200
    assert p.native_admissions == 1 and p.fatal is None
