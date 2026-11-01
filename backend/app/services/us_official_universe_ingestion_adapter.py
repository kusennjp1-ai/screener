"""US universe ingestion for the official NASDAQ Trader symbol directory.

Rows arrive already planned by ``us_reference_universe.plan_us_universe``
(continuity-preserving names, classifications and exchange identities). This
adapter reuses the Finviz adapter's canonicalisation (security master
identity, lineage and row hashes) under its own approved source name and
lifecycle reason, and ``UsUniverseCanonicalizer`` routes US rows to the right
adapter by source name so both sources share one US ingest pipeline.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from ..domain.universe.ingestion import CanonicalUniverseIngestionResult
from .finviz_universe_ingestion_adapter import FinvizUniverseIngestionAdapter, finviz_universe_ingestion_adapter
from .us_listing_directory import US_OFFICIAL_SOURCE_NAME

__all__ = ["US_OFFICIAL_SOURCE_NAME", "UsOfficialUniverseIngestionAdapter", "UsUniverseCanonicalizer"]



class UsOfficialUniverseIngestionAdapter(FinvizUniverseIngestionAdapter):
    """Canonicalise planned official-directory rows into US universe rows."""

    SOURCE_LABEL = "US official listing"
    STATUS_REASON = "Present in NASDAQ Trader symbol directory"
    UNAPPROVED_SOURCE_HINT = f"Use the '{US_OFFICIAL_SOURCE_NAME}' source identifier."

    @classmethod
    def is_approved_source(cls, source_name: str) -> bool:
        return cls.normalize_source_name(source_name) == US_OFFICIAL_SOURCE_NAME


class UsUniverseCanonicalizer:
    """Dispatch US rows to the official or Finviz adapter by source name."""

    def __init__(self, *, finviz: FinvizUniverseIngestionAdapter, official: UsOfficialUniverseIngestionAdapter) -> None:
        self._finviz = finviz
        self._official = official

    def canonicalize_rows(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        source_name: str,
        snapshot_id: str,
        snapshot_as_of: str | None = None,
        source_metadata: Mapping[str, Any] | None = None,
    ) -> CanonicalUniverseIngestionResult:
        adapter = self._official if self._official.is_approved_source(source_name) else self._finviz
        return adapter.canonicalize_rows(
            rows,
            source_name=source_name,
            snapshot_id=snapshot_id,
            snapshot_as_of=snapshot_as_of,
            source_metadata=source_metadata,
        )


us_official_universe_ingestion_adapter = UsOfficialUniverseIngestionAdapter()
us_universe_canonicalizer = UsUniverseCanonicalizer(
    finviz=finviz_universe_ingestion_adapter,
    official=us_official_universe_ingestion_adapter,
)
