from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
from models.db import init_db, SessionLocal
from routers import incidents, stream

app = FastAPI(title="CrowdSense API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
    from models.db import SessionLocal, ZoneEvent
    from datetime import datetime

    grid = None
    loop = asyncio.get_event_loop()

    while True:
        try:
            if app.state.simulator is not None and app.state.model is not None:
                # get latest frame from simulator
                frame = await loop.run_in_executor(None, app.state.simulator.get_latest_frame)

                if frame is not None:
                    # build grid on first frame
                    if grid is None:
                        h, w = frame.shape[0], frame.shape[1]
                        grid = build_grid(h, w)

                    # run ML inference in thread pool so it doesn't block async loop
                    density_map = await loop.run_in_executor(None, app.state.model.infer, frame)

                    # aggregate density into grid cells
                    cells = aggregate_density(density_map, grid)

                    # apply any active surge injection
                    surge = app.state.simulator.get_active_surge()
                    cells = apply_surge_to_counts(cells, surge)

                    # compute levels and growth rates
                    cells = compute_levels(cells, app.state.cell_history)

                    # build the websocket payload
                    payload = build_websocket_payload("festival_v1", cells)
                    app.state.latest_payload = payload

                    # log zone events to database in background
                    def write_zone_events():
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

                    await loop.run_in_executor(None, write_zone_events)

        except Exception as e:
            print(f"Pipeline loop error: {e}")

        await asyncio.sleep(1)

@app.on_event("startup")
async def startup():
    print("Starting CrowdSense API...")

    # initialize app state
    app.state.latest_payload = {}
    app.state.simulator = None
    app.state.model = None
    app.state.cell_history = {}

    # initialize database and seed guards
    init_db()
    print("Database initialized")

    # try to load simulator if demo footage exists
    footage_dir = os.path.join(os.path.dirname(__file__), "data", "demo_footage")
    mp4_files = [f for f in os.listdir(footage_dir) if f.endswith(".mp4")]
    if mp4_files:
        try:
            from ml.simulator import VideoSimulator
            video_path = os.path.join(footage_dir, mp4_files[0])
            app.state.simulator = VideoSimulator(video_path)
            app.state.simulator.start()
            print(f"Simulator started with {mp4_files[0]}")
        except Exception as e:
            print(f"Simulator not available yet: {e}")
    else:
        print("No demo footage found — simulator not started")

    # try to load ML model if weights exist
    weights_path = os.path.join(os.path.dirname(__file__), "ml", "weights", "csrnet_partA.pth")
    if os.path.exists(weights_path):
        try:
            from ml.csrnet import CSRNet
            model = CSRNet()
            model.load_weights(weights_path)
            app.state.model = model
            print("CSRNet model loaded")
        except Exception as e:
            print(f"Model not available yet: {e}")
    else:
        print("No model weights found — running in mock mode")

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
    }


