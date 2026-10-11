"""Closed, controller-owned transport for the one-shot statement capture.

An admission is a conservative pre-HTTP reservation, NOT an observed wire count.
There are no configurable production hosts, CA files, native hooks, or bypasses.
The caller additionally owns the authenticated clock, retention, immutable runtime
lock, and a fresh yfinance cache lifecycle in an otherwise unused subprocess.
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import importlib
import json
import math
import os
import platform
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

MAX_NATIVE_ADMISSIONS = 1000
MAX_SYMBOLS = 200
NATIVE_SHA256 = "79c9faa1630b25a5c0b7bd3d8fd19356fb3e98aa7ebf594a8fe3809ac65b75f0"
CA_SHA256 = "9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f"
SOURCE_HASHES = {
    "curl_cffi.requests.session": "ff3152f6e1c37078c21f9cca11da1adbed8ce7bbb67d88846597df329b940c55",
    "curl_cffi.requests.utils": "bb61f6493a70f0524a10d27a74983ef85de92526ad873bc226a55c69ebb749d4",
    "yfinance.data": "9524cded3e57db2198fce9c54db64dc654e456a19d9ccf028f29434b732405d5",
}
_ENV_DENY = frozenset({
    "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "CURL_IMPERSONATE",
    "CURL_IMPERSONATE_HEADERS", "CURL_SSL_BACKEND", "SSLKEYLOGFILE",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "QLOGDIR",
})
_SYMBOL = re.compile(r"[A-Z][A-Z0-9]{0,14}(?:-[A-Z0-9]{1,4})?\Z")
_CONTROLS = re.compile(r"[\x00-\x20\x7f]")
_SERIES_PREFIX = "/ws/fundamentals-timeseries/v1/finance/timeseries/"


class TransportStopped(RuntimeError):
    """Sanitized fatal stop; callers must never retry this job."""


def _environment_clean():
    # Presence, including an empty value, is rejected. Proxy environment variables
    # are deliberately neutralized by explicit native PROXY/PRE_PROXY/NOPROXY.
    return not any(key.upper() in _ENV_DENY or key.upper().startswith("CURL_") for key in os.environ)


def _runtime_identity():
    import certifi
    import curl_cffi
    import curl_cffi._wrapper as wrapper
    import yfinance

    if (curl_cffi.__version__ != "0.16.3" or yfinance.__version__ != "0.2.66"
            or platform.system() != "Linux" or platform.machine() != "x86_64"
            or wrapper.ffi.string(wrapper.lib.curl_version()).decode() !=
            "libcurl/8.21.0-IMPERSONATE BoringSSL zlib/1.3.1 brotli/1.2.0 zstd/1.5.7 libidn2/2.3.7 nghttp2/1.63.0 ngtcp2/1.20.0 nghttp3/1.15.0"):
        raise TransportStopped("Strict transport stopped: runtime_identity")
    paths = [(Path(wrapper.__file__), NATIVE_SHA256), (Path(certifi.where()), CA_SHA256)]
    paths.extend((Path(importlib.import_module(name).__file__), digest)
                 for name, digest in SOURCE_HASHES.items())
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != digest for path, digest in paths):
        raise TransportStopped("Strict transport stopped: runtime_identity")
    return str(Path(certifi.where()).resolve())


def _cookie_signatures(cookies):
    signatures = set()
    for cookie in cookies.jar:
        if type(cookie) is not http.cookiejar.Cookie:
            raise TransportStopped("Strict transport stopped: cookie_mutation")
        # These hashes are only in process memory, never audit output.
        signatures.add(hashlib.sha256(json.dumps(cookie.__dict__, sort_keys=True,
                                                allow_nan=False).encode()).digest())
    return frozenset(signatures)


class TransportPolicy:
    """One job-wide immutable route/budget authority; all checks fail closed.

    Both checks are required zero-argument callables. They must raise or return
    False on denial. record(event) must durably persist the sanitized reservation
    before it returns. It receives at most 1,000 reservations, 1,000 responses and one stop.
    """

    def __init__(self, symbols, deadline_monotonic, boundary_check, retention_check, record):
        values = tuple(symbols)
        if (not 1 <= len(values) <= MAX_SYMBOLS or len(set(values)) != len(values)
                or any(not isinstance(s, str) or not _SYMBOL.fullmatch(s) for s in values)
                or type(deadline_monotonic) not in (float, int)
                or not math.isfinite(deadline_monotonic)
                or not all(callable(f) for f in (boundary_check, retention_check, record))):
            raise ValueError("Invalid strict transport authority")
        self._symbols = frozenset(values)
        self._deadline = float(deadline_monotonic)
        self._boundary_check = boundary_check
        self._retention_check = retention_check
        self._record = record
        self._owner_thread = threading.get_ident()
        self._native_admissions = 0
        self._fatal = None
        self._active = False
        self._last_status = None
        self._responses_observed = 0
        self._status_counts = {}
        self._session_class = None
        if not _environment_clean():
            self._stop("environment_override")
        if time.monotonic() >= self._deadline:
            self._stop("deadline_exhausted")

    @property
    def native_admissions(self):
        return self._native_admissions

    @property
    def fatal(self):
        return self._fatal

    def audit_record(self):
        return {
            "schema_version": "strict-native-http-admissions-v1",
            "native_admissions": self._native_admissions,
            "maximum_native_admissions": MAX_NATIVE_ADMISSIONS,
            "count_semantics": "conservative_pre_http_reservations_not_observed_wire_requests",
            "fatal": self._fatal,
            "last_http_status": self._last_status,
            "responses_observed": self._responses_observed,
            "http_status_counts": dict(self._status_counts),
            "native_sha256": NATIVE_SHA256,
            "ca_sha256": CA_SHA256,
        }

    def _latch(self, reason):
        if self._fatal is None:
            self._fatal = reason
            try:
                self._record({"kind": "transport_stopped", "reason": reason,
                              "native_admissions": self._native_admissions})
            except BaseException:
                # The stop is latched even when its receipt cannot be preserved.
                pass

    def _stop(self, reason):
        self._latch(reason)
        suffix = f"; HTTP {self._last_status}" if self._fatal in {"http_status_403", "http_status_429"} else ""
        raise TransportStopped(f"Strict transport stopped: {self._fatal}{suffix}") from None

    def _assert_checks(self, session=None):
        if self._fatal is not None:
            self._stop(self._fatal)
        if threading.get_ident() != self._owner_thread:
            self._stop("thread_forbidden")
        if not _environment_clean():
            self._stop("environment_override")
        if session is not None:
            try:
                session._strict_validate()
            except TransportStopped:
                raise
            except BaseException:
                self._stop("session_mutation")
        try:
            if self._boundary_check() is False:
                self._stop("boundary_denied")
            if self._retention_check() is False:
                self._stop("retention_denied")
        except TransportStopped:
            raise
        except BaseException:
            self._stop("boundary_or_retention_failure")
        if time.monotonic() >= self._deadline:
            self._stop("deadline_exhausted")

    def _route(self, method, url, params=None):
        if method != "GET" or not isinstance(url, str) or len(url) > 65536:
            self._stop("request_forbidden")
        if _CONTROLS.search(url) or not url.isascii() or "#" in url or "\\" in url:
            self._stop("url_forbidden")
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != "https" or parsed.username is not None
                    or parsed.password is not None or parsed.port not in (None, 443)
                    or parsed.netloc not in {parsed.hostname, f"{parsed.hostname}:443"}):
                self._stop("url_forbidden")
            host, path = parsed.hostname, parsed.path
            if host == "fc.yahoo.com" and path in ("", "/"):
                route = {"route": "anonymous_cookie", "endpoint": "https://fc.yahoo.com/"}
                allowed = set()
            elif host == "query1.finance.yahoo.com" and path == "/v1/test/getcrumb":
                route = {"route": "anonymous_crumb", "endpoint": "https://query1.finance.yahoo.com/v1/test/getcrumb"}
                allowed = set()
            elif host == "query2.finance.yahoo.com" and path.startswith(_SERIES_PREFIX):
                symbol = path[len(_SERIES_PREFIX):]
                if symbol not in self._symbols:
                    self._stop("symbol_forbidden")
                route = {"route": "statement_timeseries", "symbol": symbol,
                         "endpoint": f"https://query2.finance.yahoo.com{path}"}
                allowed = {"symbol", "type", "period1", "period2", "crumb"}
            else:
                self._stop("route_forbidden")
            pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
            if params is not None:
                if type(params) is not dict or any(type(k) is not str or type(v) is not str for k, v in params.items()):
                    self._stop("params_forbidden")
                pairs.extend(params.items())
            query = {}
            for key, value in pairs:
                if key not in allowed or key in query or _CONTROLS.search(value) or not value.isascii():
                    self._stop("params_forbidden")
                query[key] = value
            if route["route"] == "statement_timeseries":
                if not {"symbol", "type", "period1", "period2"} <= query.keys() or query["symbol"] != symbol:
                    self._stop("params_forbidden")
                types = query["type"].split(",")
                if (not types or len(types) > 500
                        or any(not re.fullmatch(r"(?:annual|quarterly)[A-Z][A-Za-z0-9]{0,95}", name) for name in types)
                        or len({"annual" if name.startswith("annual") else "quarterly" for name in types}) != 1
                        or not re.fullmatch(r"\d{1,12}", query["period1"])
                        or not re.fullmatch(r"\d{1,12}", query["period2"])
                        or int(query["period1"]) >= int(query["period2"])):
                    self._stop("params_forbidden")
            canonical = urlunsplit(("https", host, path or "/", urlencode(pairs), ""))
            return canonical, route
        except TransportStopped:
            raise
        except (ValueError, TypeError, UnicodeError):
            self._stop("url_forbidden")

    def _native_callback(self, session, route, reservation):
        def callback(_user, _remote, _local, remote_port, _local_port):
            try:
                self._assert_checks(session)
                if remote_port != 443:
                    self._stop("native_port_forbidden")
                if reservation["admitted"]:
                    self._stop("native_second_admission")
                if self._native_admissions >= MAX_NATIVE_ADMISSIONS:
                    self._stop("native_budget_exhausted")
                self._native_admissions += 1
                reservation["admitted"] = True
                # Never refund this reservation, even if persistence/checks fail
                # or TLS/HTTP later sends zero bytes.
                self._record({"kind": "native_admission_reserved",
                              "sequence": self._native_admissions, **route})
                self._assert_checks(session)
                return 0
            except BaseException:
                self._latch("native_callback_failure")
                return 1
        return callback

    def session_class(self, real_requests):
        """Return the pinned yfinance-compatible Session subclass, with no bypass."""
        import curl_cffi
        from curl_cffi import Curl, CurlHttpVersion, CurlOpt
        from curl_cffi._wrapper import ffi, lib
        from curl_cffi.requests.utils import set_curl_options

        if real_requests is not curl_cffi.requests:
            self._stop("requests_identity")
        try:
            ca_path = _runtime_identity()
        except BaseException:
            self._stop("runtime_identity")
        if self._session_class is not None:
            return self._session_class
        policy = self
        response_parser = real_requests.Session._parse_response
        response_class = real_requests.Response

        class StrictSession(real_requests.Session):
            def __init__(self, *args, **kwargs):
                if args or set(kwargs) - {"impersonate"} or kwargs.get("impersonate", "chrome") != "chrome":
                    policy._stop("session_options_forbidden")
                policy._assert_checks()
                # Initialize the pinned response/cookie machinery only. No parent
                # Session native handle, retry loop, stream, or thread is used.
                real_requests.session.BaseSession.__init__(
                    self, trust_env=False, allow_redirects=False, max_redirects=0,
                    retry=0, impersonate="chrome", http_version=CurlHttpVersion.V1_1,
                )
                self._thread = None
                self._use_thread_local_curl = False
                self._curl = None
                self._queue = None
                self._executor = None
                self._strict_cookies = frozenset()
                self._strict_validate()

            def _strict_validate(self):
                fixed = {
                    "auth": None, "base_url": None, "params": None, "verify": True,
                    "timeout": 30, "trust_env": False, "allow_redirects": False,
                    "max_redirects": 0, "impersonate": "chrome", "ja3": None,
                    "akamai": None, "perk": None, "extra_fp": None,
                    "default_headers": True, "default_encoding": "utf-8",
                    "http_version": CurlHttpVersion.V1_1, "debug": False,
                    "interface": None, "doh_url": None, "cert": None,
                    "discard_cookies": False, "raise_for_status": False,
                    "proxy_auth": None, "_cache": None, "_thread": None,
                    "_use_thread_local_curl": False, "_curl": None, "_executor": None,
                }
                if self._closed:
                    policy._stop("session_closed")
                if (any(getattr(self, name, object()) != value for name, value in fixed.items())
                        or self.headers or self.proxies or self.curl_options or self.curl_infos
                        or self.retry.count != 0 or self.response_class is not response_class):
                    policy._stop("session_mutation")
                try:
                    if not _cookie_signatures(self.cookies) <= self._strict_cookies:
                        policy._stop("cookie_mutation")
                except BaseException:
                    policy._stop("cookie_mutation")

            @property
            def curl(self):
                policy._stop("raw_handle_forbidden")

            @property
            def executor(self):
                policy._stop("thread_forbidden")

            def _request_once(self, *args, **kwargs):
                policy._stop("request_bypass_forbidden")

            def ws_connect(self, *args, **kwargs):
                policy._stop("websocket_forbidden")

            def close(self):
                self._closed = True
                self.cookies.clear()
                self._strict_cookies = frozenset()

            def request(self, method, url, *args, **kwargs):
                policy._assert_checks(self)
                if policy._active:
                    policy._stop("concurrent_request_forbidden")
                if policy.native_admissions >= MAX_NATIVE_ADMISSIONS:
                    policy._stop("native_budget_exhausted")
                if args or set(kwargs) - {"params", "timeout", "allow_redirects"}:
                    policy._stop("request_options_forbidden")
                # yfinance passes True for cookie/crumb; it is intentionally
                # ignored and forced False at configuration AND native boundary.
                if "allow_redirects" in kwargs and type(kwargs["allow_redirects"]) is not bool:
                    policy._stop("request_options_forbidden")
                canonical, route = policy._route(method, url, kwargs.get("params"))
                timeout = kwargs.get("timeout", 30)
                if isinstance(timeout, tuple) and len(timeout) == 2:
                    parts = timeout
                else:
                    parts = (timeout,)
                if any(type(value) not in (float, int) or not math.isfinite(value) or value <= 0 for value in parts):
                    policy._stop("timeout_forbidden")
                timeout = min(30.0, *parts, policy._deadline - time.monotonic())
                if timeout <= 0:
                    policy._stop("deadline_exhausted")
                policy._active = True
                curl = None
                callback_ref = None
                reservation = {"admitted": False}
                try:
                    if _runtime_identity() != ca_path:
                        policy._stop("runtime_identity")
                    curl = Curl(cacert=ca_path, debug=False)
                    req, buffer, headers, _, _, _ = set_curl_options(
                        curl, method="GET", url=canonical,
                        params_list=[None, None], headers_list=[None, None],
                        cookies_list=[self.cookies, None], proxies_list=[{}, {}],
                        verify_list=[ca_path, ca_path], timeout=timeout,
                        allow_redirects=False, max_redirects=0, impersonate="chrome",
                        http_version=CurlHttpVersion.V1_1, stream=False,
                    )
                    if req.url != canonical or req.method != "GET" or req.body is not None:
                        policy._stop("configured_request_mutation")
                    policy._assert_checks(self)
                    _final_native_policy(curl, ca_path, timeout, CurlOpt, ffi, lib)
                    callback = policy._native_callback(self, route, reservation)

                    def callback_error(*_):
                        policy._latch("native_callback_bridge_failure")
                        return 1

                    callback_ref = ffi.callback(
                        "int(void *, char *, char *, int, int)", callback,
                        error=1, onerror=callback_error,
                    )
                    result = lib._curl_easy_setopt(curl._curl, 20312, ffi.cast("void *", callback_ref))
                    if result != 0:
                        policy._stop("native_hook_installation")
                    # Recompute after setup and hook installation: setup time must
                    # not extend the original acquisition/upload-reserve deadline.
                    policy._assert_checks(self)
                    remaining = min(timeout, policy._deadline - time.monotonic())
                    if remaining <= 0:
                        policy._stop("deadline_exhausted")
                    for option in (CurlOpt.TIMEOUT_MS, CurlOpt.CONNECTTIMEOUT_MS):
                        if curl.setopt(option, max(1, math.floor(remaining * 1000))) != 0:
                            policy._stop("native_option_failure")
                    # callback_ref, callback, reservation and policy remain strongly
                    # referenced until perform/response parsing/close have ended.
                    curl.perform()
                    if policy.fatal is not None:
                        policy._stop(policy.fatal)
                    if not reservation["admitted"]:
                        policy._stop("native_hook_not_invoked")
                    response = response_parser(self, curl, buffer, headers, "utf-8", False)
                    response.request = req
                    self._strict_cookies = _cookie_signatures(self.cookies)
                    status = response.status_code
                    policy._last_status = status if type(status) is int else None
                    if (type(status) is not int or response.redirect_count != 0 or response.history
                            or response.http_version != 2 or response.url != canonical
                            or response.primary_port != 443):
                        policy._stop("response_invariant")
                    policy._responses_observed += 1
                    policy._status_counts[str(status)] = policy._status_counts.get(str(status), 0) + 1
                    policy._record({"kind": "native_response_observed",
                                    "sequence": policy._native_admissions, **route,
                                    "http_status": status})
                    policy._assert_checks(self)
                    if 300 <= status < 400:
                        policy._stop("redirect_forbidden")
                    if not (200 <= status < 300 or (route["route"] == "anonymous_cookie" and status == 404)):
                        policy._stop(f"http_status_{status}")
                    policy._assert_checks(self)
                    return response
                except TransportStopped:
                    if policy.fatal is None:
                        policy._latch("native_setup_or_transport_failure")
                    raise
                except BaseException:
                    policy._stop("native_setup_or_transport_failure")
                finally:
                    try:
                        if curl is not None:
                            curl.close()
                    except BaseException:
                        policy._latch("native_cleanup_failure")
                        raise TransportStopped("Strict transport stopped: native_cleanup_failure") from None
                    finally:
                        callback_ref = None
                        policy._active = False

        self._session_class = StrictSession
        return StrictSession


def _final_native_policy(curl, ca_path, timeout, opt, ffi, lib):
    """Only invoked AFTER utility setup/impersonation, BEFORE native perform.

    Every handle is fresh and is closed rather than reset/reused. Zero SSL_OPTIONS
    excludes CURLSSLOPT_EARLYDATA; tickets and session caching are also off.
    In the pinned build SSL_FALSESTART is unconditionally NOT_BUILT_IN (setopt.c
    1103); TLS-SRP and custom DNS-server options are not built. They cannot be
    enabled. AltSvc is never initialized: both ALTSVC options are forbidden, the
    pinned utility/profile never sets either, and there is no shared state.
    ALTSVC=NULL would initialize it; ALTSVC_CTRL=0 is an invalid value here.
    Fresh handles therefore retain asi=NULL (url.c1932 excludes its lookup).
    """
    numeric = {
        "HTTP_VERSION": 2, "FOLLOWLOCATION": 0, "MAXREDIRS": 0,
        "FRESH_CONNECT": 1, "FORBID_REUSE": 1, "MAXCONNECTS": 0,
        "HTTPPROXYTUNNEL": 0, "HTTPAUTH": 0, "PROXYAUTH": 0,
        "NETRC": 0, "UNRESTRICTED_AUTH": 0, "DISALLOW_USERNAME_IN_URL": 1,
        "SSL_VERIFYPEER": 1, "SSL_VERIFYHOST": 2, "TLS_KEY_USAGE_NO_CHECK": 0,
        "PROXY_SSL_VERIFYPEER": 1, "PROXY_SSL_VERIFYHOST": 2,
        "SSL_OPTIONS": 0, "PROXY_SSL_OPTIONS": 0, "SSL_SESSIONID_CACHE": 0,
        "SSL_ENABLE_TICKET": 0, "TCP_FASTOPEN": 0,
        "SSL_ENABLE_ALPN": 0, "SSL_ENABLE_NPN": 0, "SSL_ENABLE_ALPS": 0,
        "HSTS_CTRL": 0, "CONNECT_ONLY": 0,
        "HAPROXYPROTOCOL": 0, "UPLOAD": 0, "POST": 0, "NOBODY": 0,
        "HTTPGET": 1, "VERBOSE": 0, "HEADER": 0,
        "TIMEOUT_MS": max(1, math.floor(timeout * 1000)),
        "CONNECTTIMEOUT_MS": max(1, math.floor(timeout * 1000)),
    }
    strings = {
        "PROXY": b"", "PRE_PROXY": b"", "NOPROXY": b"*",
        "PROTOCOLS_STR": b"https", "REDIR_PROTOCOLS_STR": b"https",
        "CAINFO": ca_path, "PROXY_CAINFO": ca_path,
    }
    nulls = (
        "DOH_URL", "HSTS", "CONNECT_TO", "RESOLVE",
        "USERPWD", "USERNAME", "PASSWORD", "PROXYUSERPWD", "PROXYUSERNAME",
        "PROXYPASSWORD", "NETRC_FILE", "SSLCERT", "SSLKEY", "SSLCERT_BLOB",
        "SSLKEY_BLOB", "PROXY_SSLCERT", "PROXY_SSLKEY", "PROXY_SSLCERT_BLOB",
        "PROXY_SSLKEY_BLOB", "CAINFO_BLOB", "PROXY_CAINFO_BLOB", "CAPATH",
        "PROXY_CAPATH",
        "XOAUTH2_BEARER", "COOKIEJAR", "CUSTOMREQUEST", "REQUEST_TARGET",
        "UNIX_SOCKET_PATH", "ABSTRACT_UNIX_SOCKET", "INTERFACE", "PROXYHEADER",
        "PREREQDATA",
    )
    for name, value in {**numeric, **strings}.items():
        if curl.setopt(getattr(opt, name), value) != 0:
            raise TransportStopped("Strict transport stopped: native_option_failure")
    for name in nulls:
        # The raw bridge is necessary for null callback/slist/blob options that
        # the high-level wrapper does not support. Every return is checked.
        if lib._curl_easy_setopt(curl._curl, int(getattr(opt, name)), ffi.NULL) != 0:
            raise TransportStopped("Strict transport stopped: native_option_failure")
