"""Actual Redis/Lua tests; run only in the disconnected preview containers.

This suite never contacts a provider and never substitutes fakeredis for Lua.
The two Redis instances are disposable, Unix-socket-only job-local controls.
Their successful tests do not establish cross-job/global provider coordination.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import os
from pathlib import Path
import threading
from unittest.mock import Mock

import pytest

from app.scripts.bounded_price_recovery import STRICT_RESERVE, StrictSharedBudget
from app.services.bounded_price_recovery import CaptureTransport, PilotStopped

KEYS = (
    "circuit:yfinance:us", "ratelimit:yfinance", "ratelimit:yfinance:us",
    "ratelimit:yfinance:batch", "ratelimit:yfinance:batch:us",
)
NOW = datetime(2026, 10, 6, 18, tzinfo=timezone.utc)
SHARED_SOCKET = "/control/redis.sock"
ISOLATED_SOCKET = "/isolated-control/redis.sock"
pytestmark = pytest.mark.integration


def redis_time(client):
    seconds, micros = client.time()
    return seconds + micros / 1_000_000


def reserve(client, remaining=300, intervals=(1, 2, 3, 4)):
    return float(client.eval(STRICT_RESERVE, len(KEYS), *KEYS, remaining, *intervals))


def budget_snapshot(client):
    return client.mget(KEYS[1:])


@pytest.fixture(scope="module")
def redis_module():
    if os.environ.get("PRICE_PILOT_OFFLINE_REQUIRED") != "1":
        pytest.skip("real Redis tests require the explicitly disconnected CI harness")
    # Missing redis is a hard collection/fixture error in the required CI route.
    import redis
    assert set(os.listdir("/sys/class/net")) == {"lo"}, "network boundary missing"
    assert Path(SHARED_SOCKET).is_socket()
    assert Path(ISOLATED_SOCKET).is_socket()
    return redis


@pytest.fixture
def client_factory(redis_module):
    clients = []

    def connect(path=SHARED_SOCKET):
        assert path in (SHARED_SOCKET, ISOLATED_SOCKET)
        client = redis_module.Redis(unix_socket_path=path, db=15,
                                    socket_timeout=2, socket_connect_timeout=2)
        assert client.ping()
        clients.append(client)
        return client

    # These are purpose-built ephemeral servers, never application databases.
    for path in (SHARED_SOCKET, ISOLATED_SOCKET):
        connect(path).flushdb()
    yield connect
    for client in clients:
        client.close()


@pytest.fixture
def client(client_factory):
    return client_factory()


def guarded_request(tmp_path, client, *, after_sleep=None, cancelled=None):
    elapsed = [0.0]

    def sleep(seconds):
        elapsed[0] += seconds
        if after_sleep:
            after_sleep()

    guard = CaptureTransport(
        tmp_path / "capture", rate_gate=StrictSharedBudget(client, [1, 2, 3, 4], sleep=sleep),
        clock=lambda: NOW, monotonic=lambda: elapsed[0],
        cancelled=cancelled or (lambda: False),
    )
    sender = Mock(side_effect=AssertionError("provider sender must never run"))

    def request():
        return guard.request(sender, "GET", "https://fc.yahoo.com")

    return guard, sender, request


def test_real_lua_uses_all_four_shared_keys(client):
    client.hset(KEYS[0], "state", "closed")
    before = redis_time(client)
    assert reserve(client) == 0
    after = redis_time(client)
    for key, interval in zip(KEYS[1:], (1, 2, 3, 4)):
        assert before + interval - 0.0001 <= float(client.get(key)) <= after + interval + 0.0001
        assert client.ttl(key) > 0


def test_absent_circuit_state_is_explicit_bootstrap_contract(client):
    # The production contract permits a newly initialized circuit to be closed.
    assert client.hget(KEYS[0], "state") is None
    assert reserve(client) == 0
    assert all(budget_snapshot(client))


def test_concurrent_independent_clients_reserve_one_shared_timeline(client, client_factory):
    workers = 8
    first_slot = redis_time(client) + 60
    client.hset(KEYS[0], "state", "closed")
    client.mset({key: first_slot for key in KEYS[1:]})
    clients = [client_factory() for _ in range(workers)]
    assert len({id(c.connection_pool) for c in clients}) == workers
    start = threading.Barrier(workers)

    def submit(other):
        start.wait(timeout=10)
        return reserve(other)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        delays = list(pool.map(submit, clients))
    assert all(0 < delay < 300 for delay in delays)
    # Each successful independent EVAL must advance the dominant interval once.
    for key, interval in zip(KEYS[1:], (1, 2, 3, 4)):
        assert float(client.get(key)) == pytest.approx(first_slot + (workers - 1) * 4 + interval, rel=0, abs=0.001)
    # The real returned waits must also be distinct, rather than all returning 0.
    assert len(set(delays)) == workers


@pytest.mark.parametrize("state", ["open", "half_open", "half-open", "unknown", "", "CLOSED"])
def test_non_closed_circuit_reserves_nothing_and_blocks_sender(tmp_path, client, state):
    client.hset(KEYS[0], "state", state)
    before = budget_snapshot(client)
    guard, sender, request = guarded_request(tmp_path, client)
    with pytest.raises(PilotStopped, match="shared_circuit"):
        request()
    assert budget_snapshot(client) == before
    assert guard.calls == 0
    sender.assert_not_called()


@pytest.mark.parametrize("state", ["open", "half_open"])
def test_circuit_opened_while_waiting_blocks_sender(tmp_path, client, state):
    client.hset(KEYS[0], "state", "closed")
    client.set(KEYS[-1], redis_time(client) + 0.25)
    guard, sender, request = guarded_request(
        tmp_path, client, after_sleep=lambda: client.hset(KEYS[0], "state", state))
    with pytest.raises(PilotStopped, match="shared_circuit_open_after_wait"):
        request()
    assert guard.calls == 0
    assert all(budget_snapshot(client)), "a consumed reservation is not rolled back"
    sender.assert_not_called()


def test_wait_exceeding_remaining_budget_does_not_mutate_any_key(client):
    client.hset(KEYS[0], "state", "closed")
    client.set(KEYS[2], redis_time(client) + 301)
    before = budget_snapshot(client)
    assert reserve(client, remaining=300) < 0
    assert budget_snapshot(client) == before


def test_actual_remaining_guard_deadline_rejects_wait_without_reservation(tmp_path, client):
    client.hset(KEYS[0], "state", "closed")
    client.set(KEYS[-1], redis_time(client) + 2)
    before = budget_snapshot(client)
    guard, sender, request = guarded_request(tmp_path, client)
    guard.started = -299.5
    with pytest.raises(PilotStopped, match="wait_exceeds_budget"):
        request()
    assert budget_snapshot(client) == before
    assert guard.calls == 0
    sender.assert_not_called()


@pytest.mark.parametrize("value", ["not-a-number", "", "NaN", "nan", "inf", "+inf", "-inf", "-1", "1e999"])
@pytest.mark.parametrize("key", KEYS[1:])
def test_malformed_budget_fails_closed_without_partial_reservation(tmp_path, client, key, value):
    client.hset(KEYS[0], "state", "closed")
    client.set(key, value)
    before = budget_snapshot(client)
    guard, sender, request = guarded_request(tmp_path, client)
    with pytest.raises(PilotStopped, match="shared_"):
        request()
    assert budget_snapshot(client) == before
    assert guard.calls == 0
    sender.assert_not_called()


def test_wrong_type_circuit_fails_closed(tmp_path, client):
    client.set(KEYS[0], "this must be a hash")
    guard, sender, request = guarded_request(tmp_path, client)
    with pytest.raises(PilotStopped, match="control_unavailable"):
        request()
    assert not any(budget_snapshot(client))
    assert guard.calls == 0
    sender.assert_not_called()


def test_wrong_type_budget_fails_before_any_reservation(tmp_path, client):
    client.hset(KEYS[-1], "wrong", "type")
    guard, sender, request = guarded_request(tmp_path, client)
    with pytest.raises(PilotStopped, match="control_unavailable"):
        request()
    assert client.mget(KEYS[1:-1]) == [None] * 3
    assert client.hgetall(KEYS[-1]) == {b"wrong": b"type"}
    assert guard.calls == 0
    sender.assert_not_called()


def test_control_becomes_malformed_after_wait(tmp_path, client):
    client.set(KEYS[-1], redis_time(client) + 0.25)
    guard, sender, request = guarded_request(
        tmp_path, client, after_sleep=lambda: client.set(KEYS[0], "wrong-type"))
    with pytest.raises(PilotStopped, match="control_unavailable"):
        request()
    assert guard.calls == 0
    sender.assert_not_called()


def test_unavailable_real_socket_has_no_local_fallback(tmp_path, redis_module):
    unavailable = redis_module.Redis(unix_socket_path=str(tmp_path / "absent.sock"),
                                     socket_timeout=0.2, socket_connect_timeout=0.2)
    try:
        guard, sender, request = guarded_request(tmp_path, unavailable)
        with pytest.raises(PilotStopped, match="control_unavailable"):
            request()
        assert guard.calls == 0
        sender.assert_not_called()
    finally:
        unavailable.close()


def test_cancelled_before_reservation_does_not_touch_redis(tmp_path, client):
    guard, sender, request = guarded_request(tmp_path, client, cancelled=lambda: True)
    with pytest.raises(PilotStopped, match="cancelled"):
        request()
    assert not any(budget_snapshot(client))
    assert guard.calls == 0
    sender.assert_not_called()


def test_cancelled_during_wait_keeps_consumed_reservation_and_latches(tmp_path, client):
    cancelled = [False]
    client.set(KEYS[-1], redis_time(client) + 0.25)
    guard, sender, request = guarded_request(
        tmp_path, client, after_sleep=lambda: cancelled.__setitem__(0, True),
        cancelled=lambda: cancelled[0])
    with pytest.raises(PilotStopped, match="cancelled"):
        request()
    reserved = budget_snapshot(client)
    assert all(reserved)
    cancelled[0] = False
    with pytest.raises(PilotStopped, match="cancelled"):
        request()
    assert budget_snapshot(client) == reserved
    assert guard.calls == 0
    sender.assert_not_called()


def test_separate_redis_instances_cannot_prove_global_budgeting(client, client_factory):
    isolated = client_factory(ISOLATED_SOCKET)
    assert client.info("server")["run_id"] != isolated.info("server")["run_id"]
    client.set(KEYS[-1], redis_time(client) + 301)
    assert reserve(client) < 0
    assert reserve(isolated) == 0
    assert all(budget_snapshot(isolated))
    # A successful isolated CI job has no authority over other jobs/providers.
    assert client.mget(KEYS[1:-1]) == [None] * 3


@pytest.mark.parametrize("invalid", [0, -1, "NaN", "inf", 86401, "not-a-number"])
def test_invalid_last_interval_never_partially_reserves(tmp_path, client, invalid):
    guard, sender, request = guarded_request(tmp_path, client)
    guard.rate_gate = StrictSharedBudget(client, [1, 2, 3, invalid])
    with pytest.raises(PilotStopped, match="shared_"):
        request()
    assert budget_snapshot(client) == [None] * 4
    assert guard.calls == 0
    sender.assert_not_called()


@pytest.mark.parametrize("remaining", [-1, "NaN", "inf", "not-a-number"])
def test_malformed_remaining_budget_never_reserves(client, remaining):
    assert reserve(client, remaining=remaining) < 0
    assert budget_snapshot(client) == [None] * 4
