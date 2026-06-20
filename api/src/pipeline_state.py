"""Pipeline state tracker — thread-safe singleton.

Keeps track of the currently-running and queued pipeline jobs so the API can:
1. Check if an area is already cached (skip pipeline)
2. Check if pipeline is already running for this area (dedup)
3. Queue a new area if pipeline is busy
4. Expose status via GET /pipeline/status
"""

import threading
import time
from typing import Optional


class PipelineState:
    """Thread-safe singleton tracking the single pipeline slot + queue slot."""

    _instance: Optional["PipelineState"] = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.running: Optional[str] = None       # area name currently running
        self.status: str = "idle"                # idle | scraping | processing | indexing
        self.queued: Optional[str] = None         # area waiting (max 1, overwritten)
        self.started_at: Optional[float] = None
        self.progress: Optional[str] = None

    @classmethod
    def get(cls) -> "PipelineState":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def start(self, area: str) -> bool:
        """Attempt to start pipeline for `area`. Returns False if already running."""
        with self._lock:
            if self.running is not None:
                return False
            self.running = area
            self.status = "scraping"
            self.queued = None
            self.started_at = time.time()
            self.progress = f"Starting pipeline for {area}..."
            return True

    def queue(self, area: str) -> bool:
        """Place `area` in the single queue slot. Returns False if same area running."""
        with self._lock:
            if self.running == area:
                return False  # same area already running — dedup
            self.queued = area
            return True

    def finish(self) -> Optional[str]:
        """Mark pipeline as done. Returns queued area name or None."""
        with self._lock:
            next_area = self.queued
            self.running = None
            self.status = "completed"  # keep "completed" so frontend can read result
            self.queued = None
            self.started_at = None
            # progress stays — shows final result
            return next_area

    def reset(self) -> None:
        """Reset to idle (called when frontend acknowledges completion)."""
        with self._lock:
            if self.status == "completed":
                self.status = "idle"
                self.progress = None

    def state(self) -> dict:
        """Return current state as a serializable dict."""
        with self._lock:
            elapsed = None
            if self.started_at is not None:
                elapsed = round(time.time() - self.started_at, 1)
            return {
                "running": self.running,
                "status": self.status,
                "queued": self.queued,
                "progress": self.progress,
                "elapsed_seconds": elapsed,
            }


# Convenience accessor
def get_pipeline_state() -> PipelineState:
    return PipelineState.get()
