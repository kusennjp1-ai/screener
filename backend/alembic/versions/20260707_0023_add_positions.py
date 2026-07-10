"""Add positions table for the trade-management (buy -> manage -> sell) view."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260707_0023"
down_revision = "20260629_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("positions"):
        return
    op.create_table(
        "positions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("market", sa.String(length=8), nullable=True),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("initial_stop", sa.Float(), nullable=True),
        sa.Column("shares", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="open"),
        sa.Column("close_price", sa.Float(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_positions_symbol", "positions", ["symbol"])
    op.create_index("idx_positions_status", "positions", ["status"])


def downgrade() -> None:
    op.drop_index("idx_positions_status", table_name="positions")
    op.drop_index("idx_positions_symbol", table_name="positions")
    op.drop_table("positions")
