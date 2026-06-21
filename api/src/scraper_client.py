"""HTTP client for the remote Google Maps scraper (Sprint 12).

The scraper runs as a standalone service on EC2
(http://32.236.228.8:8080) exposing the google-maps-scraper SaaS REST API
(source kept on the `main` / `services/scraper` branches — not shipped on
release/standalone). This module replaces the old in-process subprocess call
(`services/scraper/src/run.py`) for production deployments where bundling
Chromium + the Go binary inside the kos-api image is wasteful (scraper is
external).

API contract (verified live 2026-06-21):
  - Auth: `X-API-Key: <key>` header (also accepts `Authorization: Bearer <key>`)
  - POST /api/v1/scrape   body {keyword, lang, max_depth, ...} -> {job_id, status:"pending"} (202)
  - GET  /api/v1/jobs/{id} -> {status, results: [...], result_count, error}
        results[] entries use the SAME field names as the legacy Go `Entry`
        struct (title, place_id, review_rating, user_reviews, complete_address,
        longtitude/longitude, ...) so the data-processor consumes them unchanged.

Job lifecycle: pending -> running -> completed (or failed). Results are inline
in the GET job response (no separate download endpoint needed).

The result JSONL files written here are byte-for-byte compatible with the old
subprocess output: one JSON object per line at data/raw/<area>/<code>.jsonl,
collecting entries from all 3 query variants ("kos di", "kost di", "kosan di")
for that postal code into a single file (matches the legacy Go binary which
took a 3-line queries file and emitted one combined JSONL).
"""

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, List, Optional

# Query variants match services/scraper/src/generate.py — keep in sync.
_VARIANTS = ["kos di", "kost di", "kosan di"]

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"

# Job polling defaults — tuned for ~5-55s per job observed on EC2 (2026-06-21).
_POLL_INTERVAL = 3.0        # seconds between status checks
_JOB_TIMEOUT = 300.0        # max seconds per job (server caps at 300 anyway)
_MAX_BATCH_CONCURRENCY = 4  # not used (sequential submit, parallel poll below)


def is_configured() -> bool:
    """True when the remote scraper env vars are set (production mode)."""
    return bool(os.environ.get("REMOTE_SCRAPER_URL")) and bool(os.environ.get("REMOTE_SCRAPER_API_KEY"))


def scrape_area_remote(
    area: str,
    postal_codes: List[int],
    lang: str = "id",
    depth: int = 2,
) -> Dict[str, Any]:
    """Scrape all postal codes for an area via the remote scraper API.

    For each postal code, submits 3 jobs (one per query variant), polls until
    all complete, then writes the combined results to
    `data/raw/<area>/<code>.jsonl` (one JSON object per line).

    Returns a shape compatible with the legacy ensure_scraped() return:
        {"status": "scraped" | "error", "files": <int>, "scrape_age_days": 0.0,
         "message"?: <str>}
    """
    base_url = os.environ["REMOTE_SCRAPER_URL"].rstrip("/")
    api_key = os.environ["REMOTE_SCRAPER_API_KEY"]

    cache_dir = RAW_DIR / area
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Phase 1: submit ALL jobs upfront (cheap ~50ms each) so the scraper
    # worker pool can process them in parallel server-side instead of one at a
    # time. We track jobs grouped by postal code so we can split results back
    # into per-code JSONL files matching the legacy layout.
    jobs: List[Dict[str, Any]] = []  # {code, variant, job_id}
    submit_errors: List[str] = []

    for code in postal_codes:
        for variant in _VARIANTS:
            keyword = f"{variant} {code}"
            try:
                job_id = _submit_job(base_url, api_key, keyword, lang=lang, depth=depth)
                jobs.append({"code": code, "variant": variant, "job_id": job_id})
            except Exception as exc:  # noqa: BLE001 — surface all submit failures
                submit_errors.append(f"{variant} {code}: {exc}")

    if not jobs:
        return {
            "status": "error",
            "message": "All job submissions failed: " + "; ".join(submit_errors)[:300],
        }

    # Phase 2: poll all jobs until each reaches a terminal state.
    results_by_code: Dict[int, List[Dict[str, Any]]] = {code: [] for code in postal_codes}
    pending = list(jobs)
    deadline = time.time() + _JOB_TIMEOUT + 60.0  # small grace beyond per-job cap

    while pending and time.time() < deadline:
        still_pending = []
        for job in pending:
            try:
                status, results, err = _get_job(base_url, api_key, job["job_id"])
            except Exception as exc:  # noqa: BLE001 — network blip: retry once
                job["_retry"] = job.get("_retry", 0) + 1
                if job["_retry"] <= 3:
                    still_pending.append(job)
                else:
                    submit_errors.append(f"{job['variant']} {job['code']}: poll error {exc}")
                continue

            if status == "completed":
                results_by_code[job["code"]].extend(results or [])
            elif status in ("failed", "cancelled", "discarded"):
                submit_errors.append(
                    f"{job['variant']} {job['code']}: job {status} {err or ''}".strip()
                )
            else:
                # pending / running / retryable / scheduled — keep polling
                still_pending.append(job)
        pending = still_pending
        if pending:
            time.sleep(_POLL_INTERVAL)

    if pending:
        submit_errors.append(
            f"{len(pending)} job(s) timed out after {_JOB_TIMEOUT:.0f}s"
        )

    # Phase 3: write per-code JSONL files. A code with zero results still gets
    # an (empty) file so the cache layer treats it as scraped, not missing —
    # matches the legacy binary behavior where an empty output file meant
    # "scraped, nothing found".
    files_written = 0
    for code in postal_codes:
        out_path = cache_dir / f"{code}.jsonl"
        entries = results_by_code.get(code, [])
        with open(out_path, "w") as f:
            for entry in entries:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        files_written += 1

    total_results = sum(len(v) for v in results_by_code.values())
    print(
        f"[scraper-remote] {area}: {total_results} entries across {files_written} files"
        + (f" ({len(submit_errors)} errors)" if submit_errors else ""),
        flush=True,
    )

    # If we got *some* data, treat as success (partial). Only error if zero
    # results AND zero files — i.e. total failure.
    if total_results == 0 and submit_errors:
        return {
            "status": "error",
            "message": "; ".join(submit_errors)[:300],
        }

    return {
        "status": "scraped",
        "files": files_written,
        "scrape_age_days": 0.0,
    }


# ============================================================
# Internal HTTP helpers (urllib — no `requests` dependency)
# ============================================================

def _submit_job(base_url: str, api_key: str, keyword: str, lang: str, depth: int) -> str:
    """POST /api/v1/scrape -> returns job_id."""
    payload = json.dumps({
        "keyword": keyword,
        "lang": lang,
        "max_depth": depth,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/v1/scrape",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
    )
    # Short timeout: if the scraper is unreachable (e.g. VPS <-> EC2 network
    # block), fail fast instead of hanging the API worker for minutes.
    with urllib.request.urlopen(req, timeout=8) as resp:
        body = json.loads(resp.read())
    job_id = body.get("job_id")
    if not job_id:
        raise RuntimeError(f"scraper returned no job_id: {body}")
    return job_id


def _get_job(base_url: str, api_key: str, job_id: str) -> tuple:
    """GET /api/v1/jobs/{id} -> (status, results_list, error_msg)."""
    req = urllib.request.Request(
        f"{base_url}/api/v1/jobs/{job_id}",
        method="GET",
        headers={"X-API-Key": api_key},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
    return (
        body.get("status", "unknown"),
        body.get("results") or [],
        body.get("error") or "",
    )
