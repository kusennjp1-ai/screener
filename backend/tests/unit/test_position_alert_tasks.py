"""Unit tests for the daily position-alert push (message building + gating)."""
from app.schemas.digest import DigestPositionItem, DigestPositionsSection
from app.tasks.position_alert_tasks import build_position_alert_markdown


def _section(actionable):
    return DigestPositionsSection(
        open_total=5,
        actionable=actionable,
        summary=f"オープン5件中 {len(actionable)}件が要アクション",
    )


def test_alert_markdown_is_empty_when_nothing_actionable():
    assert build_position_alert_markdown(None) == ""
    assert build_position_alert_markdown(_section([])) == ""


def test_alert_markdown_renders_each_actionable_position():
    section = _section([
        DigestPositionItem(
            symbol="MSFT", entry_price=320.0, entry_date="2026-01-15",
            action="exit", r_multiple=2.07, pnl_pct=16.55,
            stop=320.0, stop_raised=True,
            note="売り：トレンド崩壊（50日線を出来高を伴い割り込み）",
        ),
        DigestPositionItem(
            symbol="FTNT", entry_price=110.0, entry_date="2026-06-01",
            action="raise_stop", r_multiple=4.7, pnl_pct=37.59,
            stop=128.87, stop_raised=True,
            note="損切りラインを切り上げ（R倍数の利益を確保）",
        ),
    ])
    message = build_position_alert_markdown(section)
    assert "ポジション・アラート" in message
    assert "オープン5件中 2件が要アクション" in message
    assert "**MSFT** [exit] +2.07R | +16.55% | stop 320.00 ↑" in message
    assert "**FTNT** [raise_stop] +4.70R | +37.59% | stop 128.87 ↑" in message


def test_alert_markdown_degrades_missing_numbers_to_dashes():
    section = _section([
        DigestPositionItem(
            symbol="ZZZZ", entry_price=50.0, entry_date="2026-02-01",
            action="tighten_stop", r_multiple=None, pnl_pct=None,
            stop=None, stop_raised=False, note="",
        ),
    ])
    message = build_position_alert_markdown(section)
    assert "**ZZZZ** [tighten_stop] - | - | stop -" in message
