"""Add next_earnings_date to stock_fundamentals (CANSLIM earnings-proximity gate).

yfinance already fetches the next-report date into the fundamentals payload,
but with no column it was dropped on the DB round-trip, so CANSLIM's
earnings-proximity gate always saw None and never fired. This column lets the
date survive so the gate works on the cached scan path.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260708_0024"
down_revision = "20260707_0023"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("stock_fundamentals")}


def upgrade() -> None:
    bind = op.get_bind()
    if "next_earnings_date" not in _columns(bind):
        op.add_column(
            "stock_fundamentals",
            sa.Column("next_earnings_date", sa.String(length=20), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "next_earnings_date" in _columns(bind):
        op.drop_column("stock_fundamentals", "next_earnings_date")
