from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import asyncio
import copy
import os
import time
from models.db import init_db
from routers import incidents, stream

app = FastAPI(title="CrowdSense API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(incidents.router, prefix="/api")
app.include_router(stream.router)


#NEEDDDD TO CHANGE WHEN IMPLEMENTING ML
#will replace the latest_payload
#so that it no longer calls the mock payload
async def pipeline_loop():
    from ml.pipeline import build_grid, aggregate_density, apply_surge_to_counts, compute_levels, build_websocket_payload
    from ml.heatmap_render import snapshot_overlay_jpeg_b64
    from models.db import SessionLocal, ZoneEvent
    from datetime import datetime

    grid = None
    loop = asyncio.get_event_loop()
    last_snapshot_ts = 0.0
    snapshot_interval = float(os.getenv("SNAPSHOT_INTERVAL_SEC", "1"))
    play_snapshot_max = int(os.getenv("DENSITY_PLAY_SNAPSHOT_MAX", "3"))
    jpeg_q = int(os.getenv("SNAPSHOT_JPEG_QUALITY", "78"))

    def write_zone_events_for_cells(cells):
        db = SessionLocal()
        try:
            for cell in cells:
                event = ZoneEvent(
                    zone_id=cell["id"],
                    venue_id="festival_v1",
                    timestamp=datetime.utcnow(),
                    count=cell["count"],
                    level=cell["level"],
                    growth_rate=cell["growth_rate"],
                )
                db.add(event)
            db.commit()
        except Exception as e:
            print(f"Zone event write error: {e}")
        finally:
            db.close()

    while True:
        try:
            if getattr(app.state, "pipeline_grid_reset", False):
                grid = None
                app.state.pipeline_grid_reset = False
            if getattr(app.state, "pipeline_snapshot_ts_reset", False):
                last_snapshot_ts = 0.0
                app.state.pipeline_snapshot_ts_reset = False

            sim_ok = app.state.simulator is not None and app.state.model is not None

            # One-shot last-frame density + JPEG after <video> ended (client sends video_ended).
            if getattr(app.state, "density_finalize_requested", False):
                if not sim_ok:
                    app.state.density_finalize_requested = False
                    app.state.density_finalize_complete = True
                else:
                    frame = await loop.run_in_executor(None, app.state.simulator.get_latest_frame)
                    if frame is not None:
                        if grid is None:
                            h, w = frame.shape[0], frame.shape[1]
                            grid = build_grid(h, w)
                        density_map = await loop.run_in_executor(None, app.state.model.infer, frame)
                        cells = aggregate_density(density_map, grid)
                        surge = app.state.simulator.get_active_surge()
                        cells = apply_surge_to_counts(cells, surge)
                        cells = compute_levels(cells, app.state.cell_history)
                        payload = build_websocket_payload("festival_v1", cells)
                        app.state.latest_payload = copy.deepcopy(payload)

                        def encode_final():
                            return snapshot_overlay_jpeg_b64(frame, density_map, jpeg_quality=jpeg_q)

                        now = time.time()
                        b64 = await loop.run_in_executor(None, encode_final)
                        app.state.latest_snapshot = {
                            "heatmap_jpeg_b64": b64,
                            "snapshot_index": app.state.snapshot_index_counter,
                            "snapshot_at_sec": now,
                            "paired_payload": copy.deepcopy(payload),
                            "is_session_final": True,
                        }
                        app.state.snapshot_index_counter += 1
                        await loop.run_in_executor(None, write_zone_events_for_cells, cells)
                    app.state.density_finalize_requested = False
                    app.state.density_finalize_complete = True
                await asyncio.sleep(1)
                continue

            if not sim_ok:
                await asyncio.sleep(1)
                continue

            if getattr(app.state, "client_playback_active", False):
                frame = await loop.run_in_executor(None, app.state.simulator.get_latest_frame)

                if frame is not None:
                    if grid is None:
                        h, w = frame.shape[0], frame.shape[1]
                        grid = build_grid(h, w)

                    density_map = await loop.run_in_executor(None, app.state.model.infer, frame)
                    cells = aggregate_density(density_map, grid)
                    surge = app.state.simulator.get_active_surge()
                    cells = apply_surge_to_counts(cells, surge)
                    cells = compute_levels(cells, app.state.cell_history)
                    payload = build_websocket_payload("festival_v1", cells)
                    app.state.latest_payload = copy.deepcopy(payload)

                    now = time.time()
                    count = getattr(app.state, "session_play_heatmap_count", 0)
                    if count < play_snapshot_max and now - last_snapshot_ts >= snapshot_interval:
                        last_snapshot_ts = now

                        def encode_snapshot():
                            return snapshot_overlay_jpeg_b64(
                                frame, density_map, jpeg_quality=jpeg_q
                            )

                        b64 = await loop.run_in_executor(None, encode_snapshot)
                        app.state.latest_snapshot = {
                            "heatmap_jpeg_b64": b64,
                            "snapshot_index": app.state.snapshot_index_counter,
                            "snapshot_at_sec": now,
                            "paired_payload": copy.deepcopy(payload),
                            "is_session_final": False,
                        }
                        app.state.snapshot_index_counter += 1
                        app.state.session_play_heatmap_count = count + 1

                    await loop.run_in_executor(None, write_zone_events_for_cells, cells)

        except Exception as e:
            print(f"Pipeline loop error: {e}")

        await asyncio.sleep(1)


def _resolve_weights_path() -> Optional[str]:
    weights_dir = os.path.join(os.path.dirname(__file__), "ml", "weights")
    for name in ("csrnet_partA.pth", "csrnet_partA.pth.tar", "PartAmodel_best.pth.tar"):
        p = os.path.join(weights_dir, name)
        if os.path.isfile(p):
            return p
    return None


def _load_csrnet_sync(weights_path: str):
    """Import torch + load weights in a worker thread (PyTorch import is slow)."""
    from ml.csrnet import CSRNet

    model = CSRNet()
    model.load_weights(weights_path)
    return model


async def load_model_background():
    weights_path = _resolve_weights_path()
    if not weights_path:
        print("No model weights found — running in mock mode")
        return
    loop = asyncio.get_event_loop()
    try:
        print(f"Loading CSRNet in background from {os.path.basename(weights_path)}…")
        model = await loop.run_in_executor(None, _load_csrnet_sync, weights_path)
        app.state.model = model
        print(f"CSRNet model loaded from {os.path.basename(weights_path)}")
    except Exception as e:
        print(f"Model not available yet: {e}")


def _resolve_demo_video_path() -> Optional[str]:
    """
    Prefer ``data/demo_footage/test.mp4``, then any other ``.mp4`` in that folder,
    then the first ``.mp4`` anywhere under ``data/``.
    """
    root = os.path.dirname(__file__)
    preferred = os.path.join(root, "data", "demo_footage", "test.mp4")
    if os.path.isfile(preferred):
        return preferred
    footage_dir = os.path.join(root, "data", "demo_footage")
    if os.path.isdir(footage_dir):
        mp4s = sorted(f for f in os.listdir(footage_dir) if f.lower().endswith(".mp4"))
        if mp4s:
            return os.path.join(footage_dir, mp4s[0])
    data_root = os.path.join(root, "data")
    if not os.path.isdir(data_root):
        return None
    for walk_root, _dirs, files in os.walk(data_root):
        for name in sorted(files):
            if name.lower().endswith(".mp4"):
                return os.path.join(walk_root, name)
    return None


@app.on_event("startup")
async def startup():
    print("Starting CrowdSense API...")

    # initialize app state
    app.state.latest_payload = {}
    app.state.latest_snapshot = {}
    app.state.snapshot_index_counter = 0
    app.state.session_play_heatmap_count = 0
    app.state.density_finalize_requested = False
    app.state.density_finalize_complete = False
    app.state.pipeline_grid_reset = False
    app.state.pipeline_snapshot_ts_reset = False
    app.state.demo_video_path = None
    app.state.simulator = None
    app.state.model = None
    app.state.cell_history = {}
    app.state.client_playback_active = False

    # initialize database and seed guards
    init_db()
    print("Database initialized")

    # Simulator + /api/video/demo: prefer data/demo_footage/test.mp4
    video_path = _resolve_demo_video_path()
    if video_path:
        app.state.demo_video_path = video_path
        try:
            from ml.simulator import VideoSimulator

            sim_fps = float(os.getenv("SIMULATOR_FPS", "12"))
            app.state.simulator = VideoSimulator(video_path, target_fps=sim_fps)
            app.state.simulator.start()
            print(f"Simulator started with {os.path.basename(video_path)} (target_fps={sim_fps})")
        except Exception as e:
            print(f"Simulator not available yet: {e}")
    else:
        print("No demo footage found — simulator not started (add data/demo_footage/test.mp4)")

    # Load PyTorch in a thread so HTTP / health / API respond immediately
    asyncio.create_task(load_model_background())

    # start background pipeline loop
    asyncio.create_task(pipeline_loop())
    print("Pipeline loop started")
    print("CrowdSense API ready!")



@app.get("/health")
def health():
    return {
        "status": "ok",
        "simulator": app.state.simulator is not None,
        "model": app.state.model is not None,
        "demo_video": _resolve_demo_video_path() is not None,
        "client_playback_active": getattr(app.state, "client_playback_active", False),
    }


@app.get("/api/video/demo")
def demo_video():
    """Demo MP4 for the dashboard — prefers ``data/demo_footage/test.mp4``."""
    path = getattr(app.state, "demo_video_path", None)
    if not path or not os.path.isfile(path):
        path = _resolve_demo_video_path()
    if not path or not os.path.isfile(path):
        raise HTTPException(
            status_code=404,
            detail="No .mp4 under backend/data — add one under data/demo_footage/",
        )
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=os.path.basename(path),
    )


