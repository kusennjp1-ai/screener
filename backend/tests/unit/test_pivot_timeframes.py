"""Pin the brief's pattern -> timeframe table to the Setup Engine detectors.

``frontend/src/static/brief/pivotBar.js`` exports ``PIVOT_TIMEFRAMES``: every ``se_pattern_primary`` the backend can
publish and the timeframe its detector reads (a weekly pattern's ``pivot_date`` is the Friday label of a W-FRI week,
a daily pattern's is the bar itself). The brief finds the pivot's own bar with it. This test parses that constant and
checks it against the detectors three ways, so neither side can change alone:

1. the table's keys are exactly the default detector set's names (each detector's candidates carry its ``name`` as
   ``pattern``, and the aggregator publishes the selected candidate's ``pattern`` as ``pattern_primary``);
2. each detector's own ``PatternCandidateModel(pattern=self.name, timeframe=...)`` in its source has the table's
   timeframe, on the file and line the table's comment names;
3. each detector, run on its golden positive case, emits candidates with that pattern and timeframe.
"""

from __future__ import annotations

import ast
import inspect
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.analysis.patterns.config import DEFAULT_SETUP_ENGINE_PARAMETERS
from app.analysis.patterns.detectors import default_pattern_detectors

REPO = Path(__file__).resolve().parents[3]
PIVOT_BAR = REPO / "frontend" / "src" / "static" / "brief" / "pivotBar.js"
ENTRY = re.compile(r'^\s*"(?P<pattern>[a-z0-9_]+)":\s*"(?P<timeframe>daily|weekly)",?\s*//\s*(?P<path>backend/[\w/]+\.py):(?P<line>\d+)\s*$')


def _table() -> tuple[dict[str, str], dict[str, tuple[str, int]]]:
    """PIVOT_TIMEFRAMES as JSON (its line comments removed) and each entry's source reference."""
    text = PIVOT_BAR.read_text(encoding="utf-8")
    match = re.search(r"export const PIVOT_TIMEFRAMES = Object\.freeze\((\{.*?\})\);", text, re.S)
    assert match, "PIVOT_TIMEFRAMES not found in pivotBar.js"
    refs: dict[str, tuple[str, int]] = {}
    code: list[str] = []
    for line in match.group(1).splitlines():
        entry = ENTRY.match(line)
        if entry:
            refs[entry["pattern"]] = (entry["path"], int(entry["line"]))
        code.append(line.split("//", 1)[0])
    table = json.loads("\n".join(code))
    assert set(refs) == set(table), "every PIVOT_TIMEFRAMES entry names its source line"
    return table, refs


TABLE, REFS = _table()
DETECTORS = {detector.name: detector for detector in default_pattern_detectors()}


def _defining_class(detector: object) -> type:
    """The class whose ``detect`` builds the candidates (CupWithHandleDetector and VCPDetector are aliases)."""
    return next(cls for cls in type(detector).__mro__ if "detect" in cls.__dict__)


def _candidate_timeframes(cls: type) -> list[tuple[str, int]]:
    """(timeframe, line) of every ``PatternCandidateModel(pattern=self.name, timeframe=...)`` inside ``cls``."""
    source = Path(inspect.getsourcefile(cls))
    tree = ast.parse(source.read_text(encoding="utf-8"))
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == cls.__name__)
    found = []
    for call in ast.walk(node):
        if not (isinstance(call, ast.Call) and getattr(call.func, "id", None) == "PatternCandidateModel"):
            continue
        keywords = {k.arg: k.value for k in call.keywords}
        pattern = keywords.get("pattern")
        if not (isinstance(pattern, ast.Attribute) and pattern.attr == "name" and getattr(pattern.value, "id", None) == "self"):
            continue
        timeframe = keywords.get("timeframe")
        assert isinstance(timeframe, ast.Constant), f"{cls.__name__}: timeframe is not a literal"
        found.append((timeframe.value, timeframe.lineno))
    return found


def test_the_table_names_exactly_the_default_detectors():
    assert set(TABLE) == set(DETECTORS)
    assert set(TABLE.values()) <= {"daily", "weekly"}


@pytest.mark.parametrize("pattern", sorted(TABLE))
def test_each_detector_builds_its_candidate_with_the_tables_timeframe_on_the_named_line(pattern):
    cls = _defining_class(DETECTORS[pattern])
    found = _candidate_timeframes(cls)
    assert found, f"{cls.__name__} builds no PatternCandidateModel(pattern=self.name, ...)"
    assert {timeframe for timeframe, _ in found} == {TABLE[pattern]}
    path, line = REFS[pattern]
    assert REPO / path == Path(inspect.getsourcefile(cls)).resolve(), f"{pattern}: the table names {path}"
    assert line in {lineno for _, lineno in found}, f"{pattern}: {path}:{line} is not the timeframe of its candidate ({found})"


def _vcp_positive(monkeypatch):
    """The golden VCP case: the legacy detect_vcp is mocked (the wrapper only maps its result)."""
    from app.analysis.patterns import vcp_wrapper
    from tests.unit.golden.conftest import golden_detector_input, golden_ohlcv_frame

    close = np.linspace(80, 130, 220)
    frame = golden_ohlcv_frame(index=pd.bdate_range("2023-01-02", periods=220), close=close)

    def detect_vcp(self, prices, volumes):
        return {"vcp_detected": True, "vcp_score": 82.5, "num_bases": 4, "contracting_depth": True, "contraction_ratio": 0.62,
                "depth_score": 88.0, "contracting_volume": True, "volume_score": 74.0, "tight_near_highs": True,
                "tightness_score": 90.0, "atr_score": 71.0, "atr_contraction_ratio": 0.68,
                "pivot_info": {"pivot": 132.25, "distance_pct": 1.8, "ready_for_breakout": True},
                "current_price": float(close[-1]), "distance_from_high_pct": 1.2}

    monkeypatch.setattr(vcp_wrapper.VCPDetector, "detect_vcp", detect_vcp)
    return golden_detector_input(symbol="GOLDEN_VCP", timeframe="daily", daily=frame)


def test_each_detector_emits_its_tables_timeframe_on_its_golden_case(monkeypatch):
    from tests.unit.golden.test_golden_detectors import _POSITIVE_CASES

    inputs = {fixture["detector"].name: fixture["input"] for _, fixture, _ in _POSITIVE_CASES}
    inputs["vcp"] = _vcp_positive(monkeypatch)
    assert set(inputs) == set(TABLE), "a golden positive case for every detector in the table"
    for pattern, detector_input in sorted(inputs.items()):
        result = DETECTORS[pattern].detect_safe(detector_input, DEFAULT_SETUP_ENGINE_PARAMETERS)
        assert result.candidates, f"{pattern}: its golden case detected nothing"
        for candidate in result.candidates:
            assert (candidate["pattern"], candidate["timeframe"]) == (pattern, TABLE[pattern])
