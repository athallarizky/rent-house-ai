"""In-process bridge to the data-processor — Sprint 8 (T2.4).

Lets the API run area processing (`scraped JSONL → cleaned docs`) in-process
instead of spawning `python -m src.pipeline <area>`. The data-processor is pure
Python (no torch/chromadb deps — see services/data-processor/pyproject.toml), so
importing it is cheap; the win is eliminating the per-call interpreter spawn
during pipeline runs.

Same importlib-alias trick as `rag_bridge.py`: the data-processor package is
`services/data-processor/src` with relative internal imports, loaded under the
unique alias `data_processor` to avoid colliding with this app's `src` package.
"""

import importlib.util
import sys
from pathlib import Path

DATA_PROCESSOR_SRC = (
    Path(__file__).resolve().parent.parent.parent / "services" / "data-processor" / "src"
)
_ALIAS = "data_processor"


def _ensure_package() -> None:
    if _ALIAS in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        _ALIAS,
        DATA_PROCESSOR_SRC / "__init__.py",
        submodule_search_locations=[str(DATA_PROCESSOR_SRC)],
    )
    assert spec is not None and spec.loader is not None, f"cannot load data-processor from {DATA_PROCESSOR_SRC}"
    pkg = importlib.util.module_from_spec(spec)
    sys.modules[_ALIAS] = pkg
    spec.loader.exec_module(pkg)


_ensure_package()

from data_processor.pipeline import process_area  # noqa: E402

__all__ = ["process_area"]
