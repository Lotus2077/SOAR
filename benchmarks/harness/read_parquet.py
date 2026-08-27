#!/usr/bin/env python3
"""Read exactly one pinned benchmark row without copying the dataset into agent space."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


if len(sys.argv) != 4:
    fail("usage: read_parquet.py FILE SELECTOR_FIELD JSON_SELECTOR_VALUE")

try:
    import pyarrow.parquet as parquet
except ImportError:
    fail("pyarrow is required to read pinned Parquet fixtures (python -m pip install pyarrow==15.0.2)")

source_path = Path(sys.argv[1]).resolve()
selector_field = sys.argv[2]
selector_value = json.loads(sys.argv[3])

try:
    table = parquet.read_table(source_path)
except Exception as error:  # pragma: no cover - pyarrow supplies format details
    fail(f"could not read {source_path}: {error}")

if selector_field not in table.column_names:
    fail(f"selector field {selector_field!r} is absent from {source_path}")

matches = [
    row
    for row in table.to_pylist()
    if str(row.get(selector_field)) == str(selector_value)
]
if len(matches) != 1:
    fail(
        f"expected one row where {selector_field}={selector_value!r}; "
        f"found {len(matches)}"
    )

json.dump(matches[0], sys.stdout, ensure_ascii=False)
