"""FastAPI entry point for Kos Search API."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .search import router as search_router
from .locations import router as locations_router
from .settings import router as settings_router
from .searches import router as searches_router
from .system import router as system_router
from .intent import router as intent_router
from .poi import router as poi_router
from .auth_routes import router as auth_router
from .pipeline_data import router as pipeline_data_router
from .users import seed_admin

app = FastAPI(
    title="Kos Search API",
    description="Semantic search for Indonesian boarding houses (kos/kost)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search_router)
app.include_router(locations_router)
app.include_router(settings_router)
app.include_router(searches_router)
app.include_router(system_router)
app.include_router(intent_router)
app.include_router(poi_router)
app.include_router(auth_router)
app.include_router(pipeline_data_router)


@app.on_event("startup")
async def startup():
    seed_admin()
    # Sprint 8: pre-load bge-m3 (~2.3 GB, ~15-25s first time) so the first
    # search request doesn't pay the load cost. Failure is non-fatal — search
    # endpoints check app.state.model_ready and return 503 if the model isn't
    # available, rather than crashing the whole container.
    app.state.model_ready = False
    try:
        from .rag_bridge import get_model
        get_model()
        app.state.model_ready = True
    except Exception as exc:  # noqa: BLE001 — startup must not abort
        print(f"[startup] bge-m3 load failed: {exc!r} — search will return 503")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "0.1.0",
        "model_ready": getattr(app.state, "model_ready", False),
    }
