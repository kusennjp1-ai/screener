"""Add nullable financial source evidence without rewriting existing values.

Shadow capture only. Apply the migration before running evidence-aware writers.
The idempotent guard also supports SQLite/new installations using create_all.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261003_0026"
down_revision = "20260708_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("stock_fundamentals")}
    if "financial_source_evidence" not in columns:
        op.add_column("stock_fundamentals", sa.Column(
            "financial_source_evidence", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True,
        ))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("stock_fundamentals")}
    if "financial_source_evidence" in columns:
        op.drop_column("stock_fundamentals", "financial_source_evidence")
