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


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
