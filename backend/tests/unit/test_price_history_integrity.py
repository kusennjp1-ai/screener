from datetime import date
from unittest.mock import Mock, call

import pandas as pd
import pytest
from app.services.cache.price_history_integrity import coherent_history, requires_full_history


def history():
    return pd.DataFrame({'Open':[100.,101.,102.],'High':[102.,103.,104.],
                         'Low':[99.,100.,101.],'Close':[101.,102.,103.],
                         'Volume':[1000.,1100.,1200.]},index=pd.date_range('2026-06-08',periods=3))


def test_incoherent_bar_requires_full_vendor_replacement():
    old=history();old.iloc[0,old.columns.get_loc('High')]=99
    assert not coherent_history(old)
    assert requires_full_history(old,history())


def test_split_adjusted_overlap_requires_full_history():
    recent=history()
    for key in ['Open','High','Low','Close']:recent[key]/=10
    assert coherent_history(recent)
    assert requires_full_history(history(),recent)


def test_identical_overlap_is_safe():
    assert not requires_full_history(history(),history())


def price_history(closes, index):
    close = pd.Series(closes, index=index, dtype=float)
    return pd.DataFrame({
        'Open': close,
        'High': close * 1.01,
        'Low': close * 0.99,
        'Close': close,
        'Volume': 1000.,
    })


@pytest.fixture
def split_history():
    # Keep every bar inside the requested period and the cache stale.
    dates = pd.date_range(end=date.today(), periods=4)
    cached = price_history([100., 101.], dates[:2])
    replacement = price_history([10., 10.1, 10., 10.1], dates)
    return cached, replacement


@pytest.mark.parametrize('recent_start', [1, 2], ids=['latest-overlap', 'no-overlap'])
def test_split_at_merge_boundary_requires_full_history(split_history, recent_start):
    cached, replacement = split_history
    recent = replacement.iloc[recent_start:]

    assert coherent_history(cached)
    assert coherent_history(recent)
    assert requires_full_history(cached, recent)


@pytest.mark.parametrize('recent_start', [1, 2], ids=['unchanged-overlap', 'no-overlap'])
def test_coherent_merge_does_not_require_full_history(split_history, recent_start):
    cached, replacement = split_history
    recent = price_history([100., 101., 102., 103.], replacement.index).iloc[recent_start:]

    assert not requires_full_history(cached, recent)


def test_merge_validation_normalizes_indexes_without_mutating_inputs(split_history):
    cached, replacement = split_history
    cached.index = pd.Index(cached.index.date)
    recent = replacement.iloc[2:].copy()
    recent.index = recent.index.tz_localize('America/New_York')
    original_cached, original_recent = cached.copy(), recent.copy()

    assert requires_full_history(cached, recent)
    pd.testing.assert_frame_equal(cached, original_cached)
    pd.testing.assert_frame_equal(recent, original_recent)


def incremental_service(monkeypatch, provider_results):
    from app.services.price_cache_service import PriceCacheService

    service = PriceCacheService(redis_client=Mock())
    calls = Mock()
    for name, method in [
        ('fetch', '_fetch_direct_historical_data'),
        ('redis', '_store_recent_in_redis'),
        ('database', '_store_in_database'),
    ]:
        operation = Mock(side_effect=provider_results) if name == 'fetch' else Mock()
        monkeypatch.setattr(service, method, operation)
        calls.attach_mock(operation, name)
    return service, calls


@pytest.mark.parametrize(
    'recent_start', [0, 1, 2], ids=['changed-overlap', 'latest-overlap', 'no-overlap']
)
def test_incremental_replacement_is_fetched_before_any_write(
    monkeypatch, split_history, recent_start
):
    cached, replacement = split_history
    recent = replacement.iloc[recent_start:]
    service, calls = incremental_service(monkeypatch, [recent, replacement])

    result = service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1].date(), market='US'
    )

    pd.testing.assert_frame_equal(result, replacement)
    assert calls.fetch.call_args_list == [call('AMD', period='7d'), call('AMD', period='2y')]
    assert [entry[0] for entry in calls.mock_calls] == ['fetch', 'fetch', 'redis', 'database']
    assert calls.redis.call_args.args[0] == 'AMD'
    assert calls.redis.call_args.kwargs == {'market': 'US'}
    pd.testing.assert_frame_equal(calls.redis.call_args.args[1], replacement)
    assert calls.database.call_args.args[0] == 'AMD'
    pd.testing.assert_frame_equal(calls.database.call_args.args[1], replacement)


@pytest.mark.parametrize(
    ('recent_start', 'latest_close'),
    [(1, 101.), (1, 101.5), (2, 101.)],
    ids=['unchanged-overlap', 'latest-close-update', 'no-overlap'],
)
def test_coherent_incremental_update_keeps_partial_fetch_and_write(
    monkeypatch, split_history, recent_start, latest_close
):
    cached, replacement = split_history
    expected = price_history([100., latest_close, 102., 103.], replacement.index)
    recent = expected.iloc[recent_start:]
    service, calls = incremental_service(monkeypatch, [recent])

    result = service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1].date(), market='US'
    )

    pd.testing.assert_frame_equal(result, expected, check_freq=False)
    calls.fetch.assert_called_once_with('AMD', period='7d')
    assert [entry[0] for entry in calls.mock_calls] == ['fetch', 'redis', 'database']
    pd.testing.assert_frame_equal(calls.redis.call_args.args[1], expected, check_freq=False)
    pd.testing.assert_frame_equal(calls.database.call_args.args[1], recent)


@pytest.mark.parametrize('failure', ['missing', 'empty', 'incoherent', 'exception'])
def test_failed_full_replacement_returns_unavailable_without_writes(
    monkeypatch, split_history, failure
):
    cached, replacement = split_history
    recent = replacement.iloc[2:]
    failed_replacement = {
        'missing': None,
        'empty': replacement.iloc[:0],
        'incoherent': pd.concat([cached, recent]),
        'exception': RuntimeError('provider unavailable'),
    }[failure]
    service, calls = incremental_service(monkeypatch, [recent, failed_replacement])

    result = service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1].date(), market='US'
    )

    assert result is None
    assert calls.fetch.call_args_list == [call('AMD', period='7d'), call('AMD', period='2y')]
    calls.redis.assert_not_called()
    calls.database.assert_not_called()


@pytest.mark.parametrize('recent_start', [58, 59, 60])
@pytest.mark.parametrize('omission', ['start', 'middle', 'latest'])
def test_incomplete_replacement_preserves_database_and_redis_artifacts(
    monkeypatch, db_session, recent_start, omission,
):
    from app.models.stock import StockPrice
    from app.services.price_cache_service import PriceCacheService

    dates = pd.date_range(end=date.today(), periods=62)
    cached = price_history([100. + i * .1 for i in range(60)], dates[:60])
    full = price_history([10. + i * .01 for i in range(62)], dates)
    replacement = {
        'start': full.iloc[-3:],
        'middle': full.drop(dates[30]),
        'latest': full.iloc[:-1],
    }[omission]
    assert coherent_history(replacement)

    redis_values = {}
    redis = Mock()
    redis.setex.side_effect = lambda key, ttl, value: redis_values.__setitem__(key, value)
    service = PriceCacheService(redis_client=redis)
    service._store_in_database('AMD', cached)
    service._store_recent_in_redis('AMD', cached, market='US')
    saved_redis = redis_values.copy()
    assert len(saved_redis) == 3  # history bytes, last session, freshness metadata
    redis.reset_mock()
    fetch = Mock(side_effect=[full.iloc[recent_start:], replacement])
    monkeypatch.setattr(service, '_fetch_direct_historical_data', fetch)

    assert service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1].date(), market='US',
    ) is None

    assert fetch.call_args_list == [call('AMD', period='7d'), call('AMD', period='2y')]
    redis.setex.assert_not_called()
    assert redis_values == saved_redis
    db_session.expire_all()
    rows = db_session.query(StockPrice).filter(StockPrice.symbol == 'AMD').order_by(StockPrice.date).all()
    assert len(rows) == len(cached)
    for row, (session, bar) in zip(rows, cached.iterrows()):
        assert row.date == session.date()
        assert (row.open, row.high, row.low, row.close, row.volume) == tuple(bar)


def test_replacement_requires_only_cached_sessions_inside_requested_window(monkeypatch):
    today = pd.Timestamp(date.today())
    dates = pd.DatetimeIndex([today - pd.Timedelta(days=n) for n in [400, 3, 2, 1, 0]])
    cached = price_history([100., 101., 102.], dates[:3])
    replacement = price_history([10.1, 10.2, 10.3, 10.4], dates[1:])
    service, calls = incremental_service(monkeypatch, [replacement.iloc[2:], replacement])

    result = service._fetch_incremental_and_merge(
        'AMD', '1y', cached, cached.index[-1].date(), market='US',
    )

    pd.testing.assert_frame_equal(result, replacement)
    assert calls.fetch.call_args_list == [call('AMD', period='7d'), call('AMD', period='1y')]
    assert [entry[0] for entry in calls.mock_calls] == ['fetch', 'fetch', 'redis', 'database']


@pytest.mark.parametrize('timezone', ['America/New_York', 'Asia/Shanghai'])
def test_replacement_coverage_uses_local_session_dates(monkeypatch, split_history, timezone):
    cached, replacement = split_history
    cached.index = pd.Index(cached.index.date)
    recent = replacement.iloc[2:].copy()
    replacement.index = replacement.index.tz_localize(timezone)
    recent.index = recent.index.tz_localize(timezone)
    service, calls = incremental_service(monkeypatch, [recent, replacement])

    result = service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1], market='US',
    )

    pd.testing.assert_frame_equal(result, replacement)
    assert [entry[0] for entry in calls.mock_calls] == ['fetch', 'fetch', 'redis', 'database']


def test_incremental_and_full_requests_keep_the_same_provider_throttle(monkeypatch, split_history):
    from app.config import settings
    from app.services.price_cache_service import PriceCacheService
    from app.services import yfinance_service

    cached, replacement = split_history
    ticker = Mock()
    ticker.history.side_effect = [replacement.iloc[2:], replacement]
    monkeypatch.setattr(yfinance_service.yf, 'Ticker', Mock(return_value=ticker))
    limiter = Mock()
    monkeypatch.setattr(yfinance_service.YFinanceService, '_fallback_rate_limiter', limiter)
    service = PriceCacheService(redis_client=Mock())
    monkeypatch.setattr(service, '_store_recent_in_redis', Mock())
    monkeypatch.setattr(service, '_store_in_database', Mock())

    result = service._fetch_incremental_and_merge(
        'AMD', '2y', cached, cached.index[-1].date(), market='US',
    )

    pd.testing.assert_frame_equal(result, replacement)
    assert ticker.history.call_args_list == [
        call(period=period, interval='1d', auto_adjust=False, actions=True)
        for period in ['7d', '2y']
    ]
    assert limiter.wait.call_args_list == [
        call('yfinance', min_interval_s=1.0 / settings.yfinance_rate_limit),
    ] * 2


def test_infinite_volume_is_rejected():
    bad=history();bad.loc[bad.index[0],'Volume']=float('inf')
    assert not coherent_history(bad)


def test_unadjusted_split_cannot_reenter_through_cache():
    bad=history()
    for key in ['Open','High','Low','Close']:bad.loc[bad.index[-1],key]/=10
    assert not coherent_history(bad)


def test_database_replaces_older_split_adjusted_rows(db_session):
    from unittest.mock import Mock
    from app.services.price_cache_service import PriceCacheService
    from app.models.stock import StockPrice
    service=PriceCacheService(redis_client=Mock())
    original=history();original.index.name='Date'
    service._store_in_database('KLAC',original)
    adjusted=original.copy()
    for key in ['Open','High','Low','Close']:adjusted[key]/=10
    service._store_in_database('KLAC',adjusted)
    db_session.expire_all()
    rows=db_session.query(StockPrice).filter(StockPrice.symbol=='KLAC').order_by(StockPrice.date).all()
    assert len(rows)==3
    assert [r.close for r in rows]==[10.1,10.2,10.3]
    # The batch path must replace historical sessions as well.
    service._store_batch_in_database({'KLAC':original})
    db_session.expire_all()
    assert [r.close for r in rows]==[101.,102.,103.]


def test_failed_incremental_fetch_returns_no_old_setup_input():
    from datetime import date
    from unittest.mock import Mock, patch
    from app.services.price_cache_service import PriceCacheService
    service=PriceCacheService(redis_client=Mock())
    with patch.object(service,'_fetch_direct_historical_data',return_value=None):
        assert service._fetch_incremental_and_merge('AMD','2y',history(),date(2020,1,1)) is None
