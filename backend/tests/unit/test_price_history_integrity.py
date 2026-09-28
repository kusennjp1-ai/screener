import pandas as pd
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
