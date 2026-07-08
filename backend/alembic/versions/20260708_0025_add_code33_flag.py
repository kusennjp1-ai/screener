"""Add code33 flag to stock_fundamentals (live Minervini earnings-acceleration).

The Code 33 engine (sec_edgar_financials) was only reachable from the static
export. This column lets the fundamentals refresh persist the flag so live
scans / buy-context / the buy checklist can surface it. Nullable: null =
unknown / not-US / EDGAR unavailable.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260708_0025"
down_revision = "20260708_0024"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("stock_fundamentals")}


def upgrade() -> None:
    bind = op.get_bind()
    if "code33" not in _columns(bind):
        op.add_column(
            "stock_fundamentals",
            sa.Column("code33", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "code33" in _columns(bind):
        op.drop_column("stock_fundamentals", "code33")
