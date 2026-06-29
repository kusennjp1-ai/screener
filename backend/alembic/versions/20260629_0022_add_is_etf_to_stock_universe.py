"""Add is_etf flag to stock_universe for ETF-excluded scans."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260629_0022"
down_revision = "20260621_0021"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("stock_universe")}


def _index_names(bind) -> set[str]:
    return {index["name"] for index in sa.inspect(bind).get_indexes("stock_universe")}


def upgrade() -> None:
    bind = op.get_bind()
    if "is_etf" not in _columns(bind):
        op.add_column(
            "stock_universe",
            sa.Column(
                "is_etf",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    if "ix_stock_universe_is_etf" not in _index_names(bind):
        op.create_index("ix_stock_universe_is_etf", "stock_universe", ["is_etf"])


def downgrade() -> None:
    bind = op.get_bind()
    if "ix_stock_universe_is_etf" in _index_names(bind):
        op.drop_index("ix_stock_universe_is_etf", table_name="stock_universe")
    if "is_etf" in _columns(bind):
        op.drop_column("stock_universe", "is_etf")
