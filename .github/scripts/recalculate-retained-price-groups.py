#!/usr/bin/env python3
"""Unpublished arithmetic adapter for the exact audited original producer.

Only the single pure ranking function is compiled. No exporter, database,
provider, financial refresh or publication entrypoint is imported or called.
"""
import ast
from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

import pandas as pd

PRODUCER_SHA256 = "d8316b2ccb45b703becaa850a674ea58aa459a687b2f57214063a502775afa6a"
path = Path(__file__).resolve().parents[2] / "backend/app/services/static_site_export_service.py"
source = path.read_bytes()
assert hashlib.sha256(source).hexdigest() == PRODUCER_SHA256, "Audited group producer changed"
functions = [node for node in ast.walk(ast.parse(source))
             if isinstance(node, ast.FunctionDef) and node.name == "_compute_group_rankings_from_serialized_rows"]
assert len(functions) == 1 and not functions[0].decorator_list, "Unexpected producer function"
def producer_sum(iterable, start=0):
    # The pinned d6cd685 Static Site workflow uses CPython 3.11. Python 3.12
    # changed float sum to compensated accumulation, which changes two of the
    # original rounded group means. Keep the producer's sequential semantics
    # explicitly on newer diagnostic hosts; never weaken original equality.
    # https://docs.python.org/3/library/functions.html#sum
    total = start
    for item in iterable:
        assert isinstance(item, (int, float)), "Unexpected producer sum input"
        total += item
    return total


namespace = {"defaultdict": defaultdict, "date": date, "Any": Any, "pd": pd, "sum": producer_sum}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), "exec"), namespace)
raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
assert len(raw) <= 8 * 1024 * 1024, "Group arithmetic input exceeds cap"
value = json.loads(raw)
assert set(value) == {"date", "before_rows", "after_rows"}, "Unexpected arithmetic input"
target = date.fromisoformat(value["date"])
assert target.isoformat() == value["date"]
function = namespace["_compute_group_rankings_from_serialized_rows"]
result = {name: function(None, value[name + "_rows"], ranking_date=target)
          for name in ("before", "after")}
json.dump(result, sys.stdout, allow_nan=False, separators=(",", ":"))
