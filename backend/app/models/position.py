"""User trading positions — the manage/sell half of the trade lifecycle.

A Position records what the user actually did (entry price, date, protective
stop, size); the live sell decision is computed on read by running the
Markets 360 sell engine (climax tells + trailing-stop ladder) against cached
prices. Nothing here trades — it is a decision-support journal.
"""
from sqlalchemy import Column, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.sql import func

from ..database import Base


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    market = Column(String(8), nullable=True)
    entry_price = Column(Float, nullable=False)
    entry_date = Column(Date, nullable=False)
    # The protective stop set at entry. The trailing ladder only ever raises
    # the effective stop from here; this column stays the ORIGINAL risk unit
    # (1R = entry_price - initial_stop).
    initial_stop = Column(Float, nullable=True)
    shares = Column(Float, nullable=True)
    status = Column(String(10), nullable=False, default="open", index=True)  # open | closed
    close_price = Column(Float, nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
