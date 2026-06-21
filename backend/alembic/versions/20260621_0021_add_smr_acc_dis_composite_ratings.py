"""Add SMR, Acc/Dis and Composite ratings for the IBD-50 leadership screen.

The screener computed only EPS Rating, RS Rating and industry-group rank, so it
could not assemble an IBD-style Composite Rating or surface an "IBD 50" leaders
list. These nullable columns persist the new ratings:

- ``scan_results.smr_rating``        — Sales+Margins+ROE percentile (0-99)
- ``scan_results.acc_dis_rating``    — Accumulation/Distribution score (0-99)
- ``scan_results.composite_rating``  — Composite Rating percentile (1-99)
- ``stock_fundamentals.smr_rating``  — universe-wide SMR percentile (0-99),
  mirroring ``eps_rating`` so the scan can read it like EPS Rating

All are nullable (NULL = not yet computed) and indexed for filtering/sorting,
matching the existing ``eps_rating`` column treatment.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260621_0021"
down_revision = "20260601_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scan_results", sa.Column("smr_rating", sa.Integer(), nullable=True))
    op.add_column("scan_results", sa.Column("acc_dis_rating", sa.Integer(), nullable=True))
    op.add_column("scan_results", sa.Column("composite_rating", sa.Integer(), nullable=True))
    op.create_index("ix_scan_results_smr_rating", "scan_results", ["smr_rating"])
    op.create_index("ix_scan_results_acc_dis_rating", "scan_results", ["acc_dis_rating"])
    op.create_index("ix_scan_results_composite_rating", "scan_results", ["composite_rating"])

    op.add_column("stock_fundamentals", sa.Column("smr_rating", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("stock_fundamentals", "smr_rating")
    op.drop_index("ix_scan_results_composite_rating", table_name="scan_results")
    op.drop_index("ix_scan_results_acc_dis_rating", table_name="scan_results")
    op.drop_index("ix_scan_results_smr_rating", table_name="scan_results")
    op.drop_column("scan_results", "composite_rating")
    op.drop_column("scan_results", "acc_dis_rating")
    op.drop_column("scan_results", "smr_rating")
