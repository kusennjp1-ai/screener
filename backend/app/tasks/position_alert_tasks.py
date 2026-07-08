"""Daily position-alert push — the sell engine's readout delivered.

Runs the same evaluation as the digest's positions section over every open
position and, when anything is ACTIONABLE, posts a compact markdown message
to a configured webhook. The payload carries both ``content`` (Discord) and
``text`` (Slack) keys so one URL setting covers either service; anything
else that accepts JSON POSTs works too.

Disabled by default: no ``POSITION_ALERT_WEBHOOK_URL`` -> the task is a
no-op. Quiet by design: nothing actionable -> nothing sent (no daily noise).
"""
import logging

from ..celery_app import celery_app
from ..config import settings
from ..database import SessionLocal

logger = logging.getLogger(__name__)


def build_position_alert_markdown(positions_section) -> str:
    """Compact alert message from a DigestPositionsSection (or None)."""
    if positions_section is None or not positions_section.actionable:
        return ""
    lines = [f"**ポジション・アラート** — {positions_section.summary}"]
    for item in positions_section.actionable:
        r_txt = f"{item.r_multiple:+.2f}R" if item.r_multiple is not None else "-"
        pnl_txt = f"{item.pnl_pct:+.2f}%" if item.pnl_pct is not None else "-"
        stop_txt = (
            f"stop {item.stop:.2f}{' ↑' if item.stop_raised else ''}"
            if item.stop is not None
            else "stop -"
        )
        lines.append(f"- **{item.symbol}** [{item.action}] {r_txt} | {pnl_txt} | {stop_txt} — {item.note}")
    return "\n".join(lines)


@celery_app.task(name="app.tasks.position_alert_tasks.send_position_alerts")
def send_position_alerts() -> dict:
    """Evaluate open positions and push actionable ones to the webhook."""
    url = settings.position_alert_webhook_url
    if not url:
        return {"status": "disabled"}

    from ..services.digest_service import DigestService

    with SessionLocal() as db:
        section = DigestService()._build_positions_section(db)  # noqa: SLF001 - single source of truth

    message = build_position_alert_markdown(section)
    if not message:
        return {"status": "quiet", "open_total": getattr(section, "open_total", 0)}

    import requests

    response = requests.post(
        url,
        json={"content": message, "text": message},
        timeout=15,
    )
    response.raise_for_status()
    logger.info(
        "position alerts sent: %d actionable of %d open",
        len(section.actionable),
        section.open_total,
    )
    return {
        "status": "sent",
        "actionable": len(section.actionable),
        "open_total": section.open_total,
    }
