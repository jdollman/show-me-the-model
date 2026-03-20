"""FastAPI backend for Show Me the Model."""

import asyncio
import json
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sse_starlette.sse import EventSourceResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.email_notify import send_results_email
from backend.jobs import STAGE_NAMES, JobStatus, JobStore
from backend.models import _PROVIDER_DEFAULTS, MODEL_REGISTRY, get_available_models, get_model_label
from backend.pipeline import run_pipeline
from backend.text_extract import extract_from_pdf, extract_from_url, validate_text
from backend.trajectories import (
    generate_group_id,
    generate_trajectory_id,
    get_reuse_stages,
    list_trajectories,
    load_trajectory,
    save_trajectory,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

store = JobStore()
limiter = Limiter(key_func=get_remote_address)

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


# --- Cleanup task ---


async def _cleanup_loop() -> None:
    """Periodically remove expired jobs."""
    while True:
        await asyncio.sleep(3600)
        store.cleanup_expired()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    asyncio.create_task(_cleanup_loop())
    yield


app = FastAPI(title="Show Me the Model", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."},
    )


# Security headers
CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "connect-src 'self'; "
    "img-src 'self' data:; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP_POLICY
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# CORS
allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
allowed_origins = [o.strip() for o in allowed_origins if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=bool(allowed_origins),  # only with explicit origins
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Helpers ---


async def _resolve_source_text(
    text: str | None,
    url: str | None,
    file: UploadFile | None,
    body: dict,
) -> tuple[str, str, str | None]:
    """Resolve whichever input source was provided.

    Returns (source_text, input_mode, source_url).
    """
    if text is None and url is None and file is None:
        text = body.get("text")
        url = body.get("url")

    sources = sum(1 for s in [text, url, file] if s is not None)
    if sources == 0:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one input: text, url, or file (PDF upload)",
        )
    if sources > 1:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one input: text, url, or file (PDF upload)",
        )

    try:
        if text:
            return validate_text(text), "text", None
        elif url:
            return await extract_from_url(url), "url", url
        else:
            pdf_bytes = await file.read()
            return await extract_from_pdf(pdf_bytes), "pdf", None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- Pipeline background task ---


async def _run_job(
    job_id: str,
    base_url: str,
    reuse_stages: dict | None = None,
    reused_stage_data: dict | None = None,
    reused_from: str | None = None,
) -> None:
    """Run the pipeline in the background, pushing events to the job's queue."""
    job = store.get(job_id)
    if not job:
        return
    job.status = JobStatus.RUNNING

    stage_data = dict(reused_stage_data) if reused_stage_data else {}

    def on_stage_complete(
        stage_name: str, result: object, usage: dict | None = None, reused: bool = False
    ) -> None:
        """Synchronous callback invoked by run_pipeline."""
        job.stages_completed.append(stage_name)
        job.partial_results[stage_name] = result
        if not reused:
            stage_data[stage_name] = {
                "model": job.workhorse_model if stage_name != "synthesis" else job.synthesis_model,
                "result": result,
                "usage": usage or {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        event = {
            "stage": stage_name,
            "name": STAGE_NAMES.get(stage_name, stage_name),
            "result": result,
            "reused": reused,
        }
        job.queue.put_nowait(("stage_complete", event))

    try:
        result = await run_pipeline(
            job.source_text,
            workhorse_model=job.workhorse_model,
            synthesis_model=job.synthesis_model,
            on_stage_complete=on_stage_complete,
            reuse_stages=reuse_stages,
        )

        analysis_id = secrets.token_urlsafe(6)
        result["analysis_id"] = analysis_id
        trajectory_id = generate_trajectory_id()
        job.trajectory_id = trajectory_id

        decomp = result.get("decomposition", {})
        result["metadata"] = {
            "workhorse_model": job.workhorse_model,
            "synthesis_model": job.synthesis_model,
            "trajectory_id": trajectory_id,
            "group_id": job.group_id,
            "estimated_cost": result.get("estimated_cost"),
            "essay_title": decomp.get("essay_title"),
            "essay_author": decomp.get("essay_author"),
            "essay_source": decomp.get("essay_source"),
            "source_url": job.source_url,
            "input_mode": job.input_mode,
        }

        save_trajectory(
            trajectory_id=trajectory_id,
            analysis_id=analysis_id,
            source_text=job.source_text,
            input_mode=job.input_mode,
            source_url=job.source_url,
            workhorse_model=job.workhorse_model,
            synthesis_model=job.synthesis_model,
            stages=stage_data,
            estimated_cost=result.get("estimated_cost", 0),
            group_id=job.group_id,
            reused_from=reused_from,
        )

        results_dir = Path(__file__).resolve().parent.parent / "results"
        results_dir.mkdir(exist_ok=True)
        result_path = results_dir / f"{analysis_id}.json"
        result_path.write_text(json.dumps(result, indent=2))
        logger.info("Saved result to %s (analysis_id=%s)", result_path, analysis_id)

        job.final_result = result
        job.status = JobStatus.COMPLETED
        job.queue.put_nowait(
            (
                "done",
                {
                    "job_id": job.id,
                    "analysis_id": analysis_id,
                    "trajectory_id": trajectory_id,
                    "result": result,
                },
            )
        )

        # Email: send only for the first completed job in the group
        if job.email:
            group_jobs = store.get_group(job.group_id)
            completed_in_group = [j for j in group_jobs if j.status == JobStatus.COMPLETED]
            if len(completed_in_group) <= 1:
                await send_results_email(job.email, analysis_id, base_url)

    except Exception as exc:
        logger.exception("Pipeline failed for job %s", job_id)
        job.status = JobStatus.FAILED
        job.error = str(exc)
        completed = set(job.stages_completed)
        stage_order = ["decomposition", "stage2", "dedup", "synthesis"]
        failed_stage = next((s for s in stage_order if s not in completed), None)
        job.error_stage = failed_stage
        job.queue.put_nowait(("error", {"message": str(exc), "stage": failed_stage}))
    finally:
        # Signal end-of-stream
        job.queue.put_nowait(None)


# --- Routes ---

MAX_CONFIGURATIONS = 5


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze(
    request: Request,
    text: str | None = Form(None),
    url: str | None = Form(None),
    email: str | None = Form(None),
    file: UploadFile | None = File(None),
    x_api_key: str | None = Header(None),
    x_provider: str | None = Header(None),
):
    """Submit text for analysis. Accepts JSON body or multipart form (for PDF upload)."""
    body: dict = {}
    if text is None and url is None and file is None:
        try:
            body = await request.json()
            email = email or body.get("email")
        except Exception:
            pass

    configurations = body.get("configurations")
    reuse_trajectory_id = body.get("reuse_trajectory")
    if not configurations:
        form = await request.form()
        raw_configs = form.get("_configurations")
        if raw_configs:
            try:
                configurations = json.loads(raw_configs)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid _configurations JSON")
        reuse_trajectory_id = reuse_trajectory_id or form.get("reuse_trajectory")

    # Backwards compatibility: old format with X-Provider header
    if not configurations:
        provider = (x_provider or "anthropic").strip().lower()
        if provider not in _PROVIDER_DEFAULTS:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
        defaults = _PROVIDER_DEFAULTS[provider]
        configurations = [
            {"workhorse_model": defaults["workhorse"], "synthesis_model": defaults["synthesis"]}
        ]

    if len(configurations) > MAX_CONFIGURATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_CONFIGURATIONS} configurations per submission",
        )

    for config in configurations:
        for key in ("workhorse_model", "synthesis_model"):
            model = config.get(key)
            if model and model not in MODEL_REGISTRY:
                raise HTTPException(status_code=400, detail=f"Unknown model: {model}")

    reuse_stages = None
    reused_stage_data = None
    reuse_meta = None
    if reuse_trajectory_id:
        try:
            reuse_stages, reuse_meta = get_reuse_stages(reuse_trajectory_id)
            reused_stage_data = reuse_meta.pop("workhorse_stage_data")
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not reuse_trajectory_id:
        if email and not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email address format")
        source_text, input_mode, source_url = await _resolve_source_text(text, url, file, body)
    else:
        source_text = reuse_meta["source_text"]
        input_mode = reuse_meta.get("input_mode", "text")
        source_url = reuse_meta.get("source_url")

    group_id = reuse_meta["group_id"] if reuse_meta else generate_group_id()
    base_url = os.getenv("BASE_URL", str(request.base_url).rstrip("/"))

    jobs = []
    for config in configurations:
        workhorse = config.get("workhorse_model") or (
            reuse_meta["workhorse_model"] if reuse_meta else None
        )
        synthesis = config["synthesis_model"]
        label = get_model_label(workhorse, synthesis)

        job = store.create(
            source_text=source_text,
            email=email,
            source_url=source_url,
            input_mode=input_mode,
            group_id=group_id,
            workhorse_model=workhorse,
            synthesis_model=synthesis,
            label=label,
        )
        asyncio.create_task(
            _run_job(
                job.id,
                base_url,
                reuse_stages=reuse_stages,
                reused_stage_data=reused_stage_data,
                reused_from=reuse_trajectory_id,
            )
        )
        jobs.append(
            {
                "job_id": job.id,
                "stream_url": f"/jobs/{job.id}/stream",
                "label": label,
            }
        )

    return {"group_id": group_id, "jobs": jobs}


@app.get("/models")
async def get_models():
    return {"models": get_available_models()}


@app.get("/trajectories")
async def get_trajectories():
    return list_trajectories()


@app.get("/trajectories/{trajectory_id}")
async def get_trajectory(trajectory_id: str):
    if not re.match(r"^t_[A-Za-z0-9_-]{6,12}$", trajectory_id):
        raise HTTPException(status_code=400, detail="Invalid trajectory ID format")
    try:
        return load_trajectory(trajectory_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> EventSourceResponse:
    """SSE stream of pipeline progress events."""
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[dict, None]:
        while True:
            msg = await job.queue.get()
            if msg is None:
                # End of stream
                break
            event_type, data = msg
            yield {"event": event_type, "data": json.dumps(data)}

    return EventSourceResponse(event_generator())


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    """Poll for current job state."""
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/results/{analysis_id}")
async def get_result(analysis_id: str) -> JSONResponse:
    """Fetch a saved analysis result by its short ID."""
    # Validate ID format to prevent path traversal
    if not re.match(r"^[A-Za-z0-9_-]{6,12}$", analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis ID format")

    results_dir = Path(__file__).resolve().parent.parent / "results"
    result_path = results_dir / f"{analysis_id}.json"

    if not result_path.is_file():
        raise HTTPException(status_code=404, detail="Analysis not found")

    data = json.loads(result_path.read_text())
    return JSONResponse(content=data)
