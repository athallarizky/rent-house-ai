"""Pipeline state manager — thread-safe single-pipeline coordinator.

Used by the search endpoint to prevent concurrent scrape/process/index
pipelines. Maximum 1 pipeline runs at a time; maximum 1 area in queue.
"""

import threading
import time
from typing import Optional


class PipelineState:
    """Thread-safe singleton tracker for the background pipeline.

    Attributes:
        running: Area name currently being processed, or None if idle.
        queued: Area name waiting to be processed, or None.
        status: Current stage — 'idle','scraping','processing','indexing'.
        started_at: Unix timestamp when the current pipeline started.
        progress: Human-readable status message.
    """

    _instance: Optional["PipelineState"] = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.running: Optional[str] = None
        self.queued: Optional[str] = None
        self.status: str = "idle"
        self.started_at: Optional[float] = None
        self.progress: Optional[str] = None

    @classmethod
    def get(cls) -> "PipelineState":
        """Return the singleton instance (thread-safe)."""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def start(self, area: str) -> bool:
        """Attempt to start a pipeline for *area*.

        Returns True if the pipeline was started, False if one is already running.
        """
        with self._lock:
            if self.running is not None:
                return False
            self.running = area
            self.queued = None
            self.status = "scraping"
            self.started_at = time.time()
            self.progress = "Starting pipeline..."
            return True

    def queue(self, area: str) -> bool:
        """Put *area* in the single-slot queue.

        Returns True if the area was queued, False if it is the same as the
        currently-running area (dedup — no need to queue).
        """
        with self._lock:
            if area == self.running:
                return False  # same area, skip — already running
            self.queued = area
            return True

    def finish(self) -> Optional[str]:
        """Mark the current pipeline as complete.

        Returns the queued area name if one exists (caller may start it next),
        or None if the queue is empty.
        """
        with self._lock:
            next_area = self.queued
            self.running = None
            self.queued = None
            self.status = "idle"
            self.started_at = None
            self.progress = None
            return next_area

    def snapshot(self) -> dict:
        """Return a read-only snapshot of the current state.

        Safe to call from any thread without holding the lock.
        """
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


def get_pipeline_state() -> PipelineState:
    """Convenience accessor for the singleton."""
    return PipelineState.get()
