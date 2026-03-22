from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime
import asyncio
import json

router = APIRouter()

# stores all active websocket connections
active_connections: set[WebSocket] = set()

# tracks which zones already have an open critical incident
# so we don't create duplicate incidents every second
known_critical_zones: set[str] = set()

async def broadcast(payload: dict):
    disconnected = set()
    for connection in active_connections:
        try:
            await connection.send_json(payload)
        except Exception:
            disconnected.add(connection)
    # clean up any broken connections
    for connection in disconnected:
        active_connections.discard(connection)


#PLACEHOLDER UNTIL ML IS FINISHED
#DO NOT DO NOT DO NOT KEEP IN FINAL
#NOT MEANT FOR FINAL
def get_mock_payload():
    return {
        "timestamp": int(datetime.utcnow().timestamp()),
        "venue_id": "festival_v1",
        "total_count": 8420,
        "venue_capacity": 12000,
        "grid": {
            "rows": 6,
            "cols": 8,
            "cells": [
                {"id": "Z-A1", "row": 0, "col": 0, "count": 32.1, "capacity": 80, "level": "safe",     "density_pct": 0.40, "growth_rate": 0.01},
                {"id": "Z-A2", "row": 0, "col": 1, "count": 51.3, "capacity": 80, "level": "watch",    "density_pct": 0.64, "growth_rate": 0.05},
                {"id": "Z-A3", "row": 0, "col": 2, "count": 28.0, "capacity": 80, "level": "safe",     "density_pct": 0.35, "growth_rate": 0.01},
                {"id": "Z-A4", "row": 0, "col": 3, "count": 40.0, "capacity": 80, "level": "safe",     "density_pct": 0.50, "growth_rate": 0.02},
                {"id": "Z-A5", "row": 0, "col": 4, "count": 55.0, "capacity": 80, "level": "watch",    "density_pct": 0.69, "growth_rate": 0.04},
                {"id": "Z-A6", "row": 0, "col": 5, "count": 20.0, "capacity": 80, "level": "safe",     "density_pct": 0.25, "growth_rate": 0.01},
                {"id": "Z-A7", "row": 0, "col": 6, "count": 38.0, "capacity": 80, "level": "safe",     "density_pct": 0.48, "growth_rate": 0.02},
                {"id": "Z-A8", "row": 0, "col": 7, "count": 44.0, "capacity": 80, "level": "safe",     "density_pct": 0.55, "growth_rate": 0.03},
                {"id": "Z-B1", "row": 1, "col": 0, "count": 60.0, "capacity": 80, "level": "watch",    "density_pct": 0.75, "growth_rate": 0.06},
                {"id": "Z-B2", "row": 1, "col": 1, "count": 35.0, "capacity": 80, "level": "safe",     "density_pct": 0.44, "growth_rate": 0.02},
                {"id": "Z-B3", "row": 1, "col": 2, "count": 50.0, "capacity": 80, "level": "watch",    "density_pct": 0.63, "growth_rate": 0.05},
                {"id": "Z-B4", "row": 1, "col": 3, "count": 30.0, "capacity": 80, "level": "safe",     "density_pct": 0.38, "growth_rate": 0.01},
                {"id": "Z-B5", "row": 1, "col": 4, "count": 45.0, "capacity": 80, "level": "safe",     "density_pct": 0.56, "growth_rate": 0.03},
                {"id": "Z-B6", "row": 1, "col": 5, "count": 65.0, "capacity": 80, "level": "watch",    "density_pct": 0.81, "growth_rate": 0.07},
                {"id": "Z-B7", "row": 1, "col": 6, "count": 22.0, "capacity": 80, "level": "safe",     "density_pct": 0.28, "growth_rate": 0.01},
                {"id": "Z-B8", "row": 1, "col": 7, "count": 48.0, "capacity": 80, "level": "safe",     "density_pct": 0.60, "growth_rate": 0.04},
                {"id": "Z-C1", "row": 2, "col": 0, "count": 70.0, "capacity": 80, "level": "warning",  "density_pct": 0.88, "growth_rate": 0.09},
                {"id": "Z-C2", "row": 2, "col": 1, "count": 33.0, "capacity": 80, "level": "safe",     "density_pct": 0.41, "growth_rate": 0.02},
                {"id": "Z-C3", "row": 2, "col": 2, "count": 58.0, "capacity": 80, "level": "watch",    "density_pct": 0.73, "growth_rate": 0.06},
                {"id": "Z-C4", "row": 2, "col": 3, "count": 78.1, "capacity": 80, "level": "critical", "density_pct": 0.98, "growth_rate": 0.21},
                {"id": "Z-C5", "row": 2, "col": 4, "count": 42.0, "capacity": 80, "level": "safe",     "density_pct": 0.53, "growth_rate": 0.03},
                {"id": "Z-C6", "row": 2, "col": 5, "count": 55.0, "capacity": 80, "level": "watch",    "density_pct": 0.69, "growth_rate": 0.05},
                {"id": "Z-C7", "row": 2, "col": 6, "count": 37.0, "capacity": 80, "level": "safe",     "density_pct": 0.46, "growth_rate": 0.02},
                {"id": "Z-C8", "row": 2, "col": 7, "count": 29.0, "capacity": 80, "level": "safe",     "density_pct": 0.36, "growth_rate": 0.01},
                {"id": "Z-D1", "row": 3, "col": 0, "count": 44.0, "capacity": 80, "level": "safe",     "density_pct": 0.55, "growth_rate": 0.03},
                {"id": "Z-D2", "row": 3, "col": 1, "count": 61.0, "capacity": 80, "level": "watch",    "density_pct": 0.76, "growth_rate": 0.06},
                {"id": "Z-D3", "row": 3, "col": 2, "count": 39.0, "capacity": 80, "level": "safe",     "density_pct": 0.49, "growth_rate": 0.02},
                {"id": "Z-D4", "row": 3, "col": 3, "count": 53.0, "capacity": 80, "level": "watch",    "density_pct": 0.66, "growth_rate": 0.05},
                {"id": "Z-D5", "row": 3, "col": 4, "count": 27.0, "capacity": 80, "level": "safe",     "density_pct": 0.34, "growth_rate": 0.01},
                {"id": "Z-D6", "row": 3, "col": 5, "count": 46.0, "capacity": 80, "level": "safe",     "density_pct": 0.58, "growth_rate": 0.03},
                {"id": "Z-D7", "row": 3, "col": 6, "count": 68.0, "capacity": 80, "level": "warning",  "density_pct": 0.85, "growth_rate": 0.08},
                {"id": "Z-D8", "row": 3, "col": 7, "count": 31.0, "capacity": 80, "level": "safe",     "density_pct": 0.39, "growth_rate": 0.02},
                {"id": "Z-E1", "row": 4, "col": 0, "count": 57.0, "capacity": 80, "level": "watch",    "density_pct": 0.71, "growth_rate": 0.05},
                {"id": "Z-E2", "row": 4, "col": 1, "count": 43.0, "capacity": 80, "level": "safe",     "density_pct": 0.54, "growth_rate": 0.03},
                {"id": "Z-E3", "row": 4, "col": 2, "count": 36.0, "capacity": 80, "level": "safe",     "density_pct": 0.45, "growth_rate": 0.02},
                {"id": "Z-E4", "row": 4, "col": 3, "count": 62.0, "capacity": 80, "level": "watch",    "density_pct": 0.78, "growth_rate": 0.06},
                {"id": "Z-E5", "row": 4, "col": 4, "count": 49.0, "capacity": 80, "level": "safe",     "density_pct": 0.61, "growth_rate": 0.04},
                {"id": "Z-E6", "row": 4, "col": 5, "count": 26.0, "capacity": 80, "level": "safe",     "density_pct": 0.33, "growth_rate": 0.01},
                {"id": "Z-E7", "row": 4, "col": 6, "count": 54.0, "capacity": 80, "level": "watch",    "density_pct": 0.68, "growth_rate": 0.05},
                {"id": "Z-E8", "row": 4, "col": 7, "count": 41.0, "capacity": 80, "level": "safe",     "density_pct": 0.51, "growth_rate": 0.03},
                {"id": "Z-F1", "row": 5, "col": 0, "count": 34.0, "capacity": 80, "level": "safe",     "density_pct": 0.43, "growth_rate": 0.02},
                {"id": "Z-F2", "row": 5, "col": 1, "count": 47.0, "capacity": 80, "level": "safe",     "density_pct": 0.59, "growth_rate": 0.03},
                {"id": "Z-F3", "row": 5, "col": 2, "count": 66.0, "capacity": 80, "level": "warning",  "density_pct": 0.83, "growth_rate": 0.08},
                {"id": "Z-F4", "row": 5, "col": 3, "count": 38.0, "capacity": 80, "level": "safe",     "density_pct": 0.48, "growth_rate": 0.02},
                {"id": "Z-F5", "row": 5, "col": 4, "count": 52.0, "capacity": 80, "level": "watch",    "density_pct": 0.65, "growth_rate": 0.05},
                {"id": "Z-F6", "row": 5, "col": 5, "count": 23.0, "capacity": 80, "level": "safe",     "density_pct": 0.29, "growth_rate": 0.01},
                {"id": "Z-F7", "row": 5, "col": 6, "count": 59.0, "capacity": 80, "level": "watch",    "density_pct": 0.74, "growth_rate": 0.06},
                {"id": "Z-F8", "row": 5, "col": 7, "count": 45.0, "capacity": 80, "level": "safe",     "density_pct": 0.56, "growth_rate": 0.03},
            ]
        },
        "alerts": [
            {
                "zone_id": "Z-C4",
                "level": "critical",
                "count": 78.1,
                "capacity": 80,
                "density_pct": 0.976,
                "growth_rate": 0.21,
                "message": "Surge detected — Zone C4 at 97.6% capacity with 21% growth"
            }
        ],
        "heatmap_jpeg_b64": None,
        "snapshot_index": 0,
        "snapshot_at_sec": None,
    }


def idle_real_payload() -> dict:
    """Empty grid when the model is loaded but the client has not started video playback yet."""
    return {
        "timestamp": int(datetime.utcnow().timestamp()),
        "venue_id": "festival_v1",
        "total_count": 0.0,
        "venue_capacity": 12000,
        "grid": {"rows": 6, "cols": 8, "cells": []},
        "alerts": [],
        "heatmap_jpeg_b64": None,
        "snapshot_index": 0,
        "snapshot_at_sec": None,
        "density_phase": "idle",
    }


def reset_density_session(app):
    """New play session: clear ML buffers, heatmap history, and restart the video simulator."""
    app.state.latest_payload = {}
    app.state.latest_snapshot = {}
    app.state.session_play_heatmap_count = 0
    app.state.density_finalize_requested = False
    app.state.density_finalize_complete = False
    app.state.snapshot_index_counter = 0
    app.state.cell_history = {}
    app.state.pipeline_grid_reset = True
    app.state.pipeline_snapshot_ts_reset = True
    sim = getattr(app.state, "simulator", None)
    if sim:
        try:
            sim.reset()
        except Exception as e:
            print(f"Simulator reset: {e}")


def merge_snapshot_into_ws_payload(app, payload: dict) -> dict:
    """Attach JPEG snapshot when available; final frame uses paired_payload so grid matches heatmap."""
    snap = getattr(app.state, "latest_snapshot", None) or {}
    b64 = snap.get("heatmap_jpeg_b64")
    has_latest = bool(getattr(app.state, "latest_payload", None))
    show = bool(b64) and (has_latest or snap.get("is_session_final"))
    out = dict(payload)
    if show:
        out["heatmap_jpeg_b64"] = b64
        out["snapshot_index"] = snap.get("snapshot_index", 0)
        out["snapshot_at_sec"] = snap.get("snapshot_at_sec")
        if snap.get("is_session_final") and isinstance(snap.get("paired_payload"), dict):
            pp = snap["paired_payload"]
            for key in ("grid", "alerts", "total_count", "timestamp", "venue_id"):
                if key in pp:
                    out[key] = pp[key]
        out["density_phase"] = "session_final_ready" if snap.get("is_session_final") else "live"
        return out
    out["heatmap_jpeg_b64"] = None
    out["snapshot_index"] = 0
    out["snapshot_at_sec"] = None
    if not has_latest:
        out["density_phase"] = "idle"
    else:
        out["density_phase"] = "no_snapshot"
    return out


async def check_and_create_incidents(payload: dict, request):
    from models.db import SessionLocal, Incident
    cells = (payload.get("grid") or {}).get("cells") or []
    if not cells:
        return
    db = SessionLocal()
    try:
        for cell in cells:
            if cell["level"] == "critical":
                zone_id = cell["id"]
                if zone_id not in known_critical_zones:
                    # check if open incident already exists
                    existing = db.query(Incident).filter(
                        Incident.zone_id == zone_id,
                        Incident.status.in_(["open", "assigned"])
                    ).first()
                    if not existing:
                        incident = Incident(
                            zone_id=zone_id,
                            level="critical",
                            density_at_trigger=cell["density_pct"],
                            growth_rate_at_trigger=cell["growth_rate"],
                        )
                        db.add(incident)
                        db.commit()
                        print(f"Auto-created incident for {zone_id}")
                    known_critical_zones.add(zone_id)
            else:
                # zone recovered, remove from known critical so it can re-trigger
                known_critical_zones.discard(cell["id"])
    finally:
        db.close()

@router.websocket("/ws/density")
async def density_websocket(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    app = websocket.app
    print(f"Client connected. Total connections: {len(active_connections)}")

    try:
        while True:
            raw = None
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                raise

            if raw:
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        if data.get("session_restart"):
                            reset_density_session(app)
                        if data.get("video_ended"):
                            app.state.client_playback_active = False
                            app.state.density_finalize_requested = True
                            app.state.density_finalize_complete = False
                            sim = getattr(app.state, "simulator", None)
                            if sim:
                                try:
                                    sim.pause()
                                except Exception:
                                    pass
                        elif "playback_playing" in data:
                            app.state.client_playback_active = bool(data["playback_playing"])
                except json.JSONDecodeError:
                    pass

            latest = app.state.latest_payload
            if not latest:
                if app.state.model is not None:
                    payload = idle_real_payload()
                else:
                    payload = get_mock_payload()
            else:
                payload = dict(latest)

            payload = merge_snapshot_into_ws_payload(app, payload)

            await check_and_create_incidents(payload, websocket)
            await websocket.send_json(payload)

    except WebSocketDisconnect:
        active_connections.discard(websocket)
        print(f"Client disconnected. Total connections: {len(active_connections)}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        active_connections.discard(websocket)
    finally:
        if len(active_connections) == 0:
            app.state.client_playback_active = False

