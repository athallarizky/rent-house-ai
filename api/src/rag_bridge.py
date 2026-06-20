"""In-process bridge to the rag-engine — Sprint 8.

Lets the API call the RAG engine (search / list_kos / rank / ingest / summarize)
directly in-process instead of spawning a Python subprocess per request. Each
subprocess today costs ~10s of redundant imports (torch + sentence-transformers
+ chromadb) plus ~4s of bge-m3 model loading; calling in-process eliminates all
of it (see docs/sprint-8/baseline.md).

The rag-engine package lives at `services/rag-engine/src` and uses *relative*
imports internally (`from .config import ...`). To avoid a namespace collision
with this app's own `src` package — which matters in local dev where the API is
launched as `src.main` (so top-level `src` already points at `api/src`) — we
load the rag-engine under a unique alias `rag_engine` via importlib. Relative
imports resolve inside that alias, so there is no collision in either Docker
(`api.src.main`) or local-dev (`src.main`) launch contexts.
"""

import importlib.util
import sys
from pathlib import Path

RAG_ENGINE_SRC = (
    Path(__file__).resolve().parent.parent.parent / "services" / "rag-engine" / "src"
)
_ALIAS = "rag_engine"


def _ensure_package() -> None:
    """Register the rag-engine `src` dir as an importable package `rag_engine`."""
    if _ALIAS in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        _ALIAS,
        RAG_ENGINE_SRC / "__init__.py",
        submodule_search_locations=[str(RAG_ENGINE_SRC)],
    )
    assert spec is not None and spec.loader is not None, f"cannot load rag-engine from {RAG_ENGINE_SRC}"
    pkg = importlib.util.module_from_spec(spec)
    sys.modules[_ALIAS] = pkg
    spec.loader.exec_module(pkg)


_ensure_package()

from rag_engine.search import search, list_kos  # noqa: E402
from rag_engine.rank import rank  # noqa: E402
from rag_engine.ingest import ingest  # noqa: E402
from rag_engine.summarize import summarize, summarize_stream  # noqa: E402
from rag_engine.model_cache import get_model  # noqa: E402

__all__ = [
    "search",
    "list_kos",
    "rank",
    "ingest",
    "summarize",
    "summarize_stream",
    "get_model",
]
