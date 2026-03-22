# CrowdShield — Agent Implementation Guide
> AI-Powered Crowd Surge Detection & Security Response  
> Hackathon Edition · v1.0 · March 2026

---

## HOW TO USE THIS DOCUMENT

This document is structured as a **sequential implementation plan**. Work through each phase in order. Each task specifies:
- Exact file to create or modify
- Precise implementation requirements
- Acceptance criteria to verify before moving on
- Dependencies on prior tasks

Do not skip ahead. Phases 1–2 (backend + ML) must be functional before Phase 4 (heatmap) can be validated with real data. Use mock WebSocket JSON for frontend development in parallel.

---

## PROJECT OVERVIEW

**What it does:** Real-time crowd safety platform. Ingests a simulated video feed, runs a CNN-based crowd density estimation model per frame, overlays a grid on the camera view, and fires graduated alerts (Watch → Warning → Critical) when crowd density in a zone exceeds thresholds or shows dangerous growth. Security operators manage incidents and dispatch guards from a live dashboard.

**Team split:** ML/Python engineer owns Phases 1–2. React/Frontend engineer owns Phases 3–6. Both integrate in Phases 7–8.

---

## REPOSITORY STRUCTURE

Create this exact directory layout before writing any code:

```
crowdshield/
├── backend/
│   ├── main.py
│   ├── routers/
│   │   ├── stream.py
│   │   ├── incidents.py
│   │   └── venues.py
│   ├── ml/
│   │   ├── csrnet.py
│   │   ├── weights/          # place pretrained .pth here
│   │   ├── pipeline.py
│   │   └── simulator.py
│   ├── models/
│   │   ├── db.py
│   │   └── schemas.py
│   ├── data/
│   │   ├── demo_footage/     # place demo .mp4 here
│   │   └── crowdshield.db     # auto-created at runtime
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── TopNav.jsx
│   │   │   ├── CameraHeatmapView.jsx
│   │   │   ├── ZoneGrid.jsx
│   │   │   ├── AlertPanel.jsx
│   │   │   ├── IncidentLog.jsx
│   │   │   ├── ZoneTrendChart.jsx
│   │   │   ├── VenueCapacityBar.jsx
│   │   │   ├── GuardRoster.jsx
│   │   │   └── ZoneDetailDrawer.jsx
│   │   ├── store/
│   │   │   ├── useStreamStore.js
│   │   │   └── useIncidentStore.js
│   │   ├── hooks/
│   │   │   └── useWebSocket.js
│   │   ├── api/
│   │   │   └── incidents.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

---

## DESIGN TOKENS (use these exact values everywhere)

```
Primary Blue:     #1A56DB   → headings, borders, primary buttons
Alert Red:        #EF4444   → Critical level, destructive states
Warning Orange:   #F97316   → Warning level
Watch Yellow:     #EAB308   → Watch level
Safe Green:       #22C55E   → Safe level, resolved incidents
Background:       #0F172A   → page/app background
Surface:          #1E293B   → card and panel backgrounds
Border:           #334155   → all borders
Text Primary:     #F1F5F9   → main text
Text Muted:       #94A3B8   → labels, timestamps, secondary info
Font:             Inter (import from Google Fonts)
Mono Font:        JetBrains Mono (import from Google Fonts)
```

**Density level → color mapping** (used in heatmap, grid, and alert badges):
```
"safe"     → #22C55E
"watch"    → #EAB308
"warning"  → #F97316
"critical" → #EF4444
```

---

## PHASE 1 — ML Core
**Owner:** ML engineer  
**Time target:** 0–4h  
**Goal:** CSRNet loads, runs inference on a single frame, and outputs a valid grid JSON.

---

### TASK 1.1 — `backend/requirements.txt`

Write the following exact dependencies:

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
websockets==12.0
opencv-python==4.9.0.80
torch==2.2.2
torchvision==0.17.2
numpy==1.26.4
Pillow==10.3.0
sqlalchemy==2.0.29
pydantic==2.7.0
python-multipart==0.0.9
```

---

### TASK 1.2 — `backend/ml/csrnet.py`

Implement the CSRNet model architecture in PyTorch.

**Requirements:**
- Frontend feature extraction uses VGG-16 layers (conv1_1 through pool3), with batch norm removed
- Backend uses dilated convolutions (dilation=2) to preserve spatial resolution
- The model accepts a `(1, 3, H, W)` float tensor normalized with ImageNet mean/std
- Output is a `(1, 1, H/8, W/8)` density map tensor
- Include a `load_weights(path: str)` function that loads a `.pth` state dict
- Include an `infer(frame_bgr: np.ndarray) -> np.ndarray` function that:
  1. Converts BGR → RGB
  2. Resizes to 512×512 (preserve aspect, pad with zeros to square)
  3. Normalizes with mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
  4. Runs forward pass under `torch.no_grad()`
  5. Upsamples output density map back to original frame resolution using bilinear interpolation
  6. Returns the density map as a float32 numpy array of shape `(H, W)`

**Pretrained weights:** Download from CSRNet-pytorch repo (ShanghaiTech Part A). Place `.pth` file at `backend/ml/weights/csrnet_partA.pth`. The `load_weights` function must print a confirmation message on success.

**Acceptance criteria:**
- `python -c "from ml.csrnet import CSRNet; m = CSRNet(); print('ok')"` runs without error
- Calling `infer()` on a 1280×720 BGR frame returns a float32 array of shape `(720, 1280)`

---

### TASK 1.3 — `backend/ml/pipeline.py`

Implement the grid aggregation and alert logic.

**Grid configuration (hardcoded for festival_v1 venue):**
```python
GRID_ROWS = 6
GRID_COLS = 8
TOTAL_CELLS = 48
DEFAULT_CELL_CAPACITY = 80   # people per cell
VENUE_TOTAL_CAPACITY = 12000
```

**Functions to implement:**

`build_grid(frame_h: int, frame_w: int) -> list[dict]`
- Returns a list of 48 cell descriptors, each with:
  `{ "id": "Z-A1", "row": 0, "col": 0, "row_start": int, "row_end": int, "col_start": int, "col_end": int, "capacity": 80 }`
- Zone IDs use letter for row (A–F), number for column (1–8): Z-A1 through Z-F8

`aggregate_density(density_map: np.ndarray, grid: list[dict]) -> list[dict]`
- For each cell, sum all values in `density_map[row_start:row_end, col_start:col_end]`
- Return list of cells enriched with `"count": float`

`compute_levels(cells: list[dict], history: dict) -> list[dict]`
- `history` is a dict keyed by zone_id containing a deque of the last 60 count readings
- For each cell, compute:
  - `density_pct = count / capacity`
  - `growth_rate`: `(current_count - count_60_readings_ago) / max(count_60_readings_ago, 1)` — use 0.0 if fewer than 60 readings
  - `level` using this exact logic:
    ```
    if density_pct >= 0.95 OR (level_was_warning AND growth_rate > 0.15):
        level = "critical"
    elif density_pct >= 0.80 OR (level_was_watch AND growth_rate > 0.10):
        level = "warning"
    elif density_pct >= 0.60:
        level = "watch"
    else:
        level = "safe"
    ```
  - Previous level must be tracked in history to apply growth-rate escalation
- Return enriched cells with `"level"`, `"growth_rate"`, `"density_pct"` fields

`build_websocket_payload(venue_id: str, cells: list[dict]) -> dict`
- Returns the full payload dict (see WebSocket Protocol section below)
- Computes `total_count` as sum of all cell counts
- Extracts cells with level `"warning"` or `"critical"` into the `"alerts"` array

**Acceptance criteria:**
- Unit test: create a 720×1280 zeros density map, spike values in a known cell region, call `aggregate_density`, verify that cell's count is nonzero and all others are zero
- `compute_levels` correctly escalates a cell to `"critical"` when `density_pct >= 0.95`

---

### TASK 1.4 — `backend/ml/simulator.py`

Implement the video file simulator.

**Class: `VideoSimulator`**

```python
class VideoSimulator:
    def __init__(self, video_path: str, target_fps: float = 1.0)
    def start(self)          # begin frame extraction loop in background thread
    def pause(self)
    def resume(self)
    def reset(self)
    def set_speed(self, multiplier: float)   # 0.5, 1.0, 2.0, 4.0
    def get_latest_frame(self) -> np.ndarray | None
    def inject_surge(self, zone_id: str, intensity: float = 2.0, duration_seconds: int = 30)
    # inject_surge: artificially multiply density map values in a given zone for demo purposes
```

**Requirements:**
- Reads an MP4 file using `cv2.VideoCapture`
- Loops the video continuously when it reaches the end
- Uses a `threading.Event` for pause/resume
- Stores the latest extracted frame in a thread-safe variable (use `threading.Lock`)
- `target_fps` controls how frequently frames are extracted (default 1.0 = 1 frame/second)
- `inject_surge` stores an active surge override; `pipeline.py` must apply a multiplier to that zone's aggregated count for the duration

**Acceptance criteria:**
- Simulator loads a local MP4, `get_latest_frame()` returns a valid BGR numpy array within 2 seconds of `start()`
- After `pause()`, `get_latest_frame()` returns the same frame repeatedly
- After `reset()`, frame counter returns to 0

---

## PHASE 2 — FastAPI Server
**Owner:** ML engineer (frontend engineer can start Phase 3 in parallel)  
**Time target:** 2–6h  
**Goal:** WebSocket pushes live density data; REST endpoints handle incidents and guards.

---

### TASK 2.1 — `backend/models/db.py`

Define SQLAlchemy ORM models. Use SQLite at `data/crowdshield.db`. Call `Base.metadata.create_all()` on startup.

**Table: `incidents`**
```
id                    INTEGER PRIMARY KEY AUTOINCREMENT
zone_id               TEXT NOT NULL
venue_id              TEXT NOT NULL DEFAULT 'festival_v1'
level                 TEXT NOT NULL  -- 'watch' | 'warning' | 'critical'
density_at_trigger    REAL
growth_rate_at_trigger REAL
guard_id              INTEGER REFERENCES guards(id) NULLABLE
status                TEXT NOT NULL DEFAULT 'open'  -- 'open' | 'assigned' | 'resolved'
opened_at             DATETIME DEFAULT CURRENT_TIMESTAMP
assigned_at           DATETIME NULLABLE
resolved_at           DATETIME NULLABLE
notes                 TEXT NULLABLE
```

**Table: `guards`**
```
id                INTEGER PRIMARY KEY AUTOINCREMENT
name              TEXT NOT NULL
badge_number      TEXT NOT NULL UNIQUE
status            TEXT NOT NULL DEFAULT 'available'  -- 'available' | 'dispatched'
current_zone_id   TEXT NULLABLE
```

**Table: `zone_events`** (append-only density log, never update/delete)
```
id           INTEGER PRIMARY KEY AUTOINCREMENT
zone_id      TEXT NOT NULL
venue_id     TEXT NOT NULL
timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
count        REAL NOT NULL
level        TEXT NOT NULL
growth_rate  REAL NOT NULL
```

**Seed data:** On first startup (empty DB), insert 8 guards:
```
Marcus Webb   · badge: G-001
Sarah Chen    · badge: G-002
Devon Parks   · badge: G-003
Lila Torres   · badge: G-004
James Okoro   · badge: G-005
Priya Nair    · badge: G-006
Tyler Brooks  · badge: G-007
Aisha Grant   · badge: G-008
```

---

### TASK 2.2 — `backend/models/schemas.py`

Define Pydantic v2 schemas for all request/response bodies:

```python
class CellSchema(BaseModel):
    id: str
    row: int
    col: int
    count: float
    capacity: int
    level: str        # 'safe' | 'watch' | 'warning' | 'critical'
    density_pct: float
    growth_rate: float

class AlertSchema(BaseModel):
    zone_id: str
    level: str
    count: float
    capacity: int
    density_pct: float
    growth_rate: float
    message: str

class DensityPayload(BaseModel):
    timestamp: int
    venue_id: str
    total_count: float
    venue_capacity: int
    grid: dict        # { "rows": 6, "cols": 8, "cells": list[CellSchema] }
    alerts: list[AlertSchema]

class IncidentCreate(BaseModel):
    zone_id: str
    level: str
    density_at_trigger: float
    growth_rate_at_trigger: float

class IncidentUpdate(BaseModel):
    status: str | None = None
    guard_id: int | None = None
    notes: str | None = None

class IncidentResponse(BaseModel):
    id: int
    zone_id: str
    venue_id: str
    level: str
    density_at_trigger: float
    growth_rate_at_trigger: float
    guard_id: int | None
    status: str
    opened_at: str
    assigned_at: str | None
    resolved_at: str | None
    notes: str | None

class GuardResponse(BaseModel):
    id: int
    name: str
    badge_number: str
    status: str
    current_zone_id: str | None
```

---

### TASK 2.3 — `backend/routers/stream.py`

Implement the WebSocket endpoint.

**Endpoint:** `GET /ws/density` (WebSocket upgrade)

**Behavior:**
- On connection, immediately send the current density payload
- Push a new `DensityPayload` JSON message every 1 second (configurable via `STREAM_INTERVAL_SECONDS` env var)
- If no frame is available from the simulator, send a payload with all cells at count=0
- On disconnect, clean up without crashing
- Handle multiple simultaneous WebSocket connections (store in a `set` of active connections)
- When a cell transitions to `"critical"` for the first time (not already open incident for that zone), auto-create an incident via the incidents service

**WebSocket payload shape:**
```json
{
  "timestamp": 1711900000,
  "venue_id": "festival_v1",
  "total_count": 8420,
  "venue_capacity": 12000,
  "grid": {
    "rows": 6,
    "cols": 8,
    "cells": [
      {
        "id": "Z-A1",
        "row": 0,
        "col": 0,
        "count": 42.3,
        "capacity": 80,
        "level": "watch",
        "density_pct": 0.53,
        "growth_rate": 0.08
      }
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
  ]
}
```

---

### TASK 2.4 — `backend/routers/incidents.py`

Implement all incident REST endpoints.

```
GET    /incidents                → list all incidents; query params: status (str), limit (int, default 50)
POST   /incidents                → create incident from IncidentCreate body; return IncidentResponse
GET    /incidents/{id}           → get single incident by id
PATCH  /incidents/{id}           → update status/guard_id/notes via IncidentUpdate body
POST   /incidents/{id}/assign    → body: { "guard_id": int }
                                   → set incident status = 'assigned', assigned_at = now
                                   → set guard status = 'dispatched', current_zone_id = incident.zone_id
                                   → return updated IncidentResponse
POST   /incidents/{id}/resolve   → set status = 'resolved', resolved_at = now
                                   → free the assigned guard: status = 'available', current_zone_id = null
                                   → return updated IncidentResponse
GET    /guards                   → list all guards with current status
GET    /zones/{zone_id}/history  → return last N zone_events for zone_id; query param: limit (default 60)
POST   /stream/control           → body: { "action": "play" | "pause" | "reset", "speed": float }
                                   → delegate to VideoSimulator instance
```

**Business rules:**
- Assigning a guard who is already `'dispatched'` must return HTTP 409 with message `"Guard is already dispatched"`
- Resolving an incident that is `'open'` (never assigned) is allowed; skip guard status update in that case
- Creating an incident for a zone that already has an `'open'` or `'assigned'` incident must return HTTP 409 with message `"Active incident already exists for zone {zone_id}"`

---

### TASK 2.5 — `backend/main.py`

Wire everything together.

**Requirements:**
- Create FastAPI app with CORS enabled for `http://localhost:5173` (Vite dev server)
- Include routers: `stream`, `incidents`
- On startup (`@app.on_event("startup")`):
  1. Initialize SQLite DB (create tables + seed guards if empty)
  2. Load CSRNet model weights from `ml/weights/csrnet_partA.pth`
  3. Start `VideoSimulator` with the first `.mp4` found in `data/demo_footage/`
  4. Start the background pipeline loop (runs inference every `1/target_fps` seconds, updates a shared in-memory state dict that the WebSocket handler reads)
- Store shared state in a module-level `app.state` object:
  ```python
  app.state.simulator = VideoSimulator(...)
  app.state.model = CSRNet(...)
  app.state.latest_payload = {}   # updated by pipeline loop
  app.state.cell_history = {}     # zone_id → deque(maxlen=60)
  ```
- Run with: `uvicorn main:app --reload --port 8000`

**Acceptance criteria:**
- `GET /docs` loads FastAPI auto-docs without error
- WebSocket at `ws://localhost:8000/ws/density` sends a valid JSON payload within 2 seconds of connection
- `POST /incidents` creates a row in SQLite and returns it

---

## PHASE 3 — Frontend Shell
**Owner:** Frontend engineer  
**Time target:** 3–7h  
**Prerequisite:** Can start immediately; use mock WebSocket data until Phase 2 is ready.

---

### TASK 3.1 — Frontend project setup

Run:
```bash
cd frontend
npm create vite@latest . -- --template react
npm install tailwindcss postcss autoprefixer recharts zustand
npx tailwindcss init -p
```

**`tailwind.config.js`** — extend theme with design tokens:
```js
theme: {
  extend: {
    colors: {
      primary:  '#1A56DB',
      critical: '#EF4444',
      warning:  '#F97316',
      watch:    '#EAB308',
      safe:     '#22C55E',
      surface:  '#1E293B',
      border:   '#334155',
    },
    fontFamily: {
      sans: ['Inter', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    }
  }
}
```

**`index.html`** — add Google Fonts import for Inter and JetBrains Mono.

**`vite.config.js`** — configure proxy:
```js
server: {
  proxy: {
    '/api': 'http://localhost:8000',
    '/ws': { target: 'ws://localhost:8000', ws: true }
  }
}
```

---

### TASK 3.2 — `frontend/src/hooks/useWebSocket.js`

Implement a WebSocket connection hook.

**Requirements:**
- Connects to `ws://localhost:8000/ws/density`
- On message: parse JSON, call `useStreamStore.setState({ payload: data })`
- Auto-reconnects after 3 seconds on disconnect
- Exports: `useWebSocket()` — call this once in `App.jsx`
- Exposes `connectionStatus`: `'connecting' | 'connected' | 'disconnected'`

**Mock mode:** If `import.meta.env.VITE_MOCK_WS === 'true'`, generate random density payload every 1 second instead of connecting to real WebSocket. This allows frontend development before the backend is ready.

Mock payload generator must produce:
- 48 cells (6 rows × 8 cols) with random counts between 0–90
- At least one cell forced to `"critical"` level (Z-C4, count=78)
- Realistic `growth_rate` values (0.0–0.3)

---

### TASK 3.3 — `frontend/src/store/useStreamStore.js`

```js
// Zustand store shape:
{
  payload: null,           // latest DensityPayload from WebSocket
  selectedZoneId: null,    // zone clicked by user
  connectionStatus: 'disconnected',
  setPayload: (payload) => ...,
  setSelectedZone: (zoneId) => ...,
  setConnectionStatus: (status) => ...,
}
```

---

### TASK 3.4 — `frontend/src/store/useIncidentStore.js`

```js
// Zustand store shape:
{
  incidents: [],           // IncidentResponse[]
  guards: [],              // GuardResponse[]
  fetchIncidents: async () => ...,
  fetchGuards: async () => ...,
  assignGuard: async (incidentId, guardId) => ...,
  resolveIncident: async (incidentId) => ...,
  createIncident: async (data) => ...,
}
```

All async actions call the REST API (see `api/incidents.js`) and update local state on success.

---

### TASK 3.5 — `frontend/src/api/incidents.js`

Implement these functions (all return parsed JSON or throw on error):

```js
export const getIncidents = (status) => fetch(`/api/incidents?status=${status||''}`).then(r => r.json())
export const createIncident = (data) => fetch('/api/incidents', { method: 'POST', ... })
export const assignGuard = (incidentId, guardId) => fetch(`/api/incidents/${incidentId}/assign`, { method: 'POST', ... })
export const resolveIncident = (incidentId) => fetch(`/api/incidents/${incidentId}/resolve`, { method: 'POST' })
export const getGuards = () => fetch('/api/guards').then(r => r.json())
export const getZoneHistory = (zoneId, limit=60) => fetch(`/api/zones/${zoneId}/history?limit=${limit}`).then(r => r.json())
export const controlStream = (action, speed) => fetch('/api/stream/control', { method: 'POST', ... })
```

---

### TASK 3.6 — `frontend/src/App.jsx`

**Layout (3-column, full viewport, no scroll on outer container):**
```
┌─────────────────────────────────────────────────────────────────┐
│                         TopNav (h-14)                           │
├──────────────┬───────────────────────────────┬──────────────────┤
│  Left Sidebar│      Center Main              │   Right Panel    │
│   (w-60)     │      (flex-1)                 │   (w-85)         │
│              │                               │                  │
│ VenueCapacity│  CameraHeatmapView            │  AlertPanel      │
│ GuardRoster  │  ZoneGrid                     │  IncidentLog     │
│              │                               │  ZoneTrendChart  │
└──────────────┴───────────────────────────────┴──────────────────┘
```

**Requirements:**
- Background: `bg-[#0F172A]`, full height `h-screen`, `overflow-hidden`
- Call `useWebSocket()` once at top level
- Call `fetchIncidents()` and `fetchGuards()` on mount, refresh every 10 seconds
- Render `ZoneDetailDrawer` as an overlay (conditionally when `selectedZoneId !== null`)
- All panels use `bg-[#1E293B]` surface color with `border border-[#334155]` borders

---

## PHASE 4 — Camera Heatmap View
**Owner:** Frontend engineer  
**Time target:** 5–9h  
**Prerequisite:** Task 3.2 mock WebSocket working, so real density data flows in.

---

### TASK 4.1 — `frontend/src/components/CameraHeatmapView.jsx`

This is the primary visual component. It renders the camera frame with a density heatmap overlaid.

**Props:** None — reads from `useStreamStore`

**Structure:**
- Outer `div` is `relative` with a fixed aspect ratio (16:9)
- Layer 1 (bottom): `<img>` tag displaying the latest camera frame (base64 JPEG from WebSocket, or a static festival crowd placeholder image if no frame available)
- Layer 2 (middle): `<canvas>` absolutely positioned over the image, same dimensions — renders the heatmap
- Layer 3 (top): `<canvas>` for grid borders and zone ID labels

**Heatmap rendering (Layer 2 canvas):**
- For each cell, fill its rectangle with the level color at 40% opacity:
  ```
  safe:     rgba(34, 197, 94,  0.15)
  watch:    rgba(234, 179, 8,  0.35)
  warning:  rgba(249, 115, 22, 0.50)
  critical: rgba(239, 68, 68,  0.65)
  ```
- Apply a Gaussian blur (`ctx.filter = 'blur(8px)'`) to the fill layer before drawing borders, creating a smooth heatmap gradient between adjacent cells

**Grid border rendering (Layer 3 canvas):**
- Draw 2px border around each cell in the level's solid color (no opacity)
- For `"critical"` cells: border width 3px, apply a CSS `animation: pulse 1s ease-in-out infinite` via a class toggle on the canvas wrapper
- On hover over a cell: show a tooltip with `Zone ID · Count / Capacity · Level · Growth Rate`
- On click: call `setSelectedZone(cell.id)`

**Opacity slider:**
- `<input type="range" min="0" max="100" defaultValue="70">` below the camera view
- Controls the opacity of Layer 2 (heatmap fill canvas) in real time
- Label: "Heatmap Opacity"

**Frame update:**
- If the WebSocket payload includes a `frame_b64` field (base64 JPEG), update the `<img>` src
- If not present, show a static placeholder image (use any royalty-free festival crowd photo URL)

---

### TASK 4.2 — `frontend/src/components/ZoneGrid.jsx`

Miniaturized 8×6 grid of colored tiles below the camera view.

**Requirements:**
- Each tile is a small square (approx 40×32px) with the level background color at 80% opacity
- Display zone ID in mono font, 9px, centered
- Tiles with `"critical"` level pulse using a CSS keyframe animation (`opacity: 1 → 0.4 → 1`, 1s loop)
- Clicking a tile calls `setSelectedZone(cell.id)`
- Selected tile has a white 2px border
- No labels on tiles other than zone ID — keep it dense

---

## PHASE 5 — Alert Panel & Incident Management
**Owner:** Frontend engineer  
**Time target:** 7–12h

---

### TASK 5.1 — `frontend/src/components/AlertPanel.jsx`

**Requirements:**
- Header: "Active Alerts" + count badge (number of current warning/critical alerts)
- Scrollable list of alert cards sorted by: critical first, then warning, then by timestamp descending
- Each alert card contains:
  - Zone ID in mono font, large
  - Level badge (colored pill: background = level color at 20% opacity, text = level color, border = level color)
  - Density %: e.g. "97.6% capacity"
  - Growth rate: e.g. "↑ 21% in 60s" (show in red if > 15%, orange if 5–15%, muted if < 5%)
  - Time elapsed since alert triggered: e.g. "2m 14s ago"
  - Two action buttons:
    - **"Assign Guard"** → opens `GuardPickerModal` (see below)
    - **"Dismiss"** → calls `resolveIncident(incidentId)` and removes card
- When a new `"critical"` alert appears (not previously in list): flash the entire panel border red for 1.5 seconds using a CSS animation
- Empty state: "No active alerts — all zones normal" with a green checkmark icon

**GuardPickerModal:**
- Triggered by "Assign Guard" button
- Overlay modal (dark background blur)
- Lists available guards (status = 'available') with name and badge number
- Clicking a guard calls `assignGuard(incidentId, guardId)`, closes modal
- If no guards available: show "All guards currently dispatched"

---

### TASK 5.2 — `frontend/src/components/IncidentLog.jsx`

**Requirements:**
- Header: "Incident Log" + filter tabs: All / Open / Assigned / Resolved
- Table with columns: Zone · Level · Guard · Opened · Duration · Status
- Duration column:
  - For open/assigned: show elapsed time since opened_at, updating live
  - For resolved: show total duration (resolved_at − opened_at)
- Status column: colored pill (same level color system)
- Resolved rows are visually dimmed (opacity 60%) with a green checkmark
- "Resolve" button on assigned rows → calls `resolveIncident`
- Maximum 50 rows shown; oldest resolved incidents drop off the bottom
- Refresh from store every 10 seconds (already handled by `App.jsx` interval)

---

## PHASE 6 — Charts, Capacity, Guards, Drawer
**Owner:** Frontend engineer  
**Time target:** 10–16h

---

### TASK 6.1 — `frontend/src/components/ZoneTrendChart.jsx`

**Requirements:**
- Uses Recharts `LineChart` with `ResponsiveContainer`
- X axis: last 60 data points (1 per second = last 60 seconds); labels as "−60s", "−30s", "now"
- Y axis: people count (0 to max cell capacity, default 80)
- Shows up to 4 zone lines simultaneously, each a distinct color from this set: `#1A56DB, #22C55E, #F97316, #A855F7`
- Horizontal dashed `ReferenceLine` at each shown zone's capacity value (same color as line, 50% opacity)
- Zone selector: small multi-select of zone IDs — default shows `Z-C4` (the demo surge zone)
- Data source: `useStreamStore` payload — maintain a rolling buffer of the last 60 payloads in the store
- `TooltipContent` shows: zone ID, count, level, growth_rate for the hovered point
- Header: "Zone Density Trend"

**Add to `useStreamStore`:**
```js
payloadHistory: [],   // last 60 DensityPayload objects
```
On each new payload, push to history and keep only the last 60.

---

### TASK 6.2 — `frontend/src/components/VenueCapacityBar.jsx`

**Requirements:**
- Horizontal progress bar: `total_count / venue_capacity`
- Color transitions:
  - < 60%: `#22C55E` (safe green)
  - 60–79%: `#EAB308` (watch yellow)
  - 80–94%: `#F97316` (warning orange)
  - ≥ 95%: `#EF4444` (critical red)
- Text above bar: "Festival Grounds Capacity"
- Text below bar: "8,420 / 12,000 (70%)" — uses live total_count from store
- Smooth CSS transition on bar width change (`transition: width 0.5s ease`)

---

### TASK 6.3 — `frontend/src/components/GuardRoster.jsx`

**Requirements:**
- Header: "Security Team"
- List of all 8 guards (from `useIncidentStore`)
- Each row:
  - Guard name
  - Badge number in muted mono font
  - Status pill: "Available" (green) or "Dispatched" (orange)
  - If dispatched: show assigned zone ID in orange mono font
- Sort: dispatched guards first, then available alphabetically
- Updates reactively when `assignGuard` or `resolveIncident` is called

---

### TASK 6.4 — `frontend/src/components/ZoneDetailDrawer.jsx`

**Requirements:**
- Slide-in panel from the right (CSS `transform: translateX` transition, 300ms)
- Triggered when `selectedZoneId !== null` in store
- Close button (×) sets `selectedZoneId` to null
- Content for the selected zone:
  - Large zone ID header
  - Current level badge
  - Stats grid: Count · Capacity · Density % · Growth Rate
  - Mini sparkline: last 30 data points for this zone (use Recharts `AreaChart`, no axes)
  - Active incident card (if one exists for this zone): shows status and assigned guard
  - "Assign Guard" button (if no active incident or incident is unassigned)
  - "Resolve Incident" button (if assigned incident exists)
  - Incident history: last 5 resolved incidents for this zone (opened, duration, guard)

---

### TASK 6.5 — `frontend/src/components/TopNav.jsx`

**Requirements:**
- Left: "CrowdShield" wordmark in Inter bold, primary blue
- Center: "Festival Grounds · Live Event" venue/event name
- Center-right: Pulsing dot + "LIVE" text (green) or "PAUSED" (yellow) or "OFFLINE" (red) based on `connectionStatus`
- Right: `VenueCapacityBar` condensed inline (just the bar + percentage, no label)
- Right-edge: timestamp of last processed frame: "Last frame: 14:23:05"
- Stream controls: Play ▶ / Pause ⏸ / Reset ↺ buttons — call `controlStream` API
- Background: `bg-[#1E293B]` with bottom border `border-b border-[#334155]`

---

## PHASE 7 — Integration
**Owner:** Both engineers  
**Time target:** 15–20h

**Checklist — do not proceed to Phase 8 until all pass:**

- [ ] WebSocket connects and dashboard updates live with density data
- [ ] Heatmap cells correctly color based on level from payload
- [ ] Zone Z-C4 can be manually forced to critical via `inject_surge` API and alert fires
- [ ] Alert panel shows the Z-C4 critical alert with correct density % and growth rate
- [ ] Clicking "Assign Guard" → selecting Marcus Webb → guard status changes to Dispatched in GuardRoster
- [ ] Incident created in DB, visible in IncidentLog under "Assigned" tab
- [ ] Clicking "Resolve" → guard returns to Available, incident shows in "Resolved" tab with duration
- [ ] ZoneTrendChart shows rising line for Z-C4 during surge, peak visible after resolution
- [ ] VenueCapacityBar updates in real time
- [ ] ZoneDetailDrawer opens on cell click, shows correct zone data
- [ ] Stream pause/play/reset controls work end-to-end

**Known integration issues to watch for:**
- CORS errors: confirm `http://localhost:5173` is in FastAPI allowed origins
- WebSocket reconnect: refresh the page, confirm auto-reconnect happens within 3 seconds
- SQLite concurrency: FastAPI background thread writes zone_events; ensure SQLAlchemy session is per-request, not shared

---

## PHASE 8 — Demo Polish
**Owner:** Both engineers  
**Time target:** 20–24h

### Demo footage setup
- Place a concert/festival crowd MP4 in `backend/data/demo_footage/`
- Recommended free source: Pexels.com search "concert crowd" or "festival crowd" — download highest resolution available
- If no footage available: use ShanghaiTech dataset video samples (crowd footage used to train CSRNet)

### Scripted demo surge sequence
Implement this as a `POST /demo/run-scenario` endpoint that triggers automatically:

```
T+0s:   All zones safe, capacity at 65%
T+10s:  Z-C4 rises to Watch (inject_surge zone=Z-C4 intensity=1.3)
T+25s:  Z-C4 rises to Warning (intensity=1.7)
T+40s:  Z-C4 hits Critical (intensity=2.2) → alert fires automatically
T+55s:  (operator assigns guard in UI)
T+90s:  Z-C4 density drops — inject_surge ends, zone returns to Safe
```

### CSS animations to add
```css
/* Pulsing critical zone tile */
@keyframes pulse-critical {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  50%       { opacity: 0.7; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}

/* Alert panel flash on new critical */
@keyframes flash-border {
  0%, 100% { border-color: #334155; }
  25%, 75%  { border-color: #EF4444; }
}
```

### Final polish checklist
- [ ] Replace all placeholder text with "Festival Grounds" venue name
- [ ] Ensure all 8 guards appear in GuardRoster on load
- [ ] Verify heatmap opacity slider works smoothly
- [ ] Confirm ZoneTrendChart shows correct multi-line for Z-C4 during scenario
- [ ] All timestamps display in local time (not UTC)
- [ ] No console errors during normal operation
- [ ] Resize browser to 1280×800 — confirm no layout breaks

---

## WEBSOCKET MOCK PAYLOAD (for frontend dev before backend ready)

Use this exact structure when `VITE_MOCK_WS=true`:

```json
{
  "timestamp": 1711900000,
  "venue_id": "festival_v1",
  "total_count": 8420,
  "venue_capacity": 12000,
  "grid": {
    "rows": 6,
    "cols": 8,
    "cells": [
      { "id": "Z-A1", "row": 0, "col": 0, "count": 32.1, "capacity": 80, "level": "safe",     "density_pct": 0.40, "growth_rate": 0.01 },
      { "id": "Z-A2", "row": 0, "col": 1, "count": 51.3, "capacity": 80, "level": "watch",    "density_pct": 0.64, "growth_rate": 0.05 },
      { "id": "Z-C4", "row": 2, "col": 3, "count": 78.1, "capacity": 80, "level": "critical", "density_pct": 0.98, "growth_rate": 0.21 }
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
  ]
}
```

---

## SURGE DETECTION ALGORITHM (exact implementation reference)

```python
THRESHOLDS = {
    "safe":     (0.00, 0.60),
    "watch":    (0.60, 0.80),
    "warning":  (0.80, 0.95),
    "critical": (0.95, float('inf')),
}

def compute_level(density_pct, growth_rate, prev_level):
    if density_pct >= 0.95:
        return "critical"
    if density_pct >= 0.80:
        return "warning"
    # Growth-rate escalation: upgrade if trending dangerously
    if prev_level == "warning" and growth_rate > 0.15:
        return "critical"
    if prev_level == "watch" and growth_rate > 0.10:
        return "warning"
    if density_pct >= 0.60:
        return "watch"
    return "safe"
```

---

## SUCCESS METRICS

| Metric | Target | How to verify |
|--------|--------|---------------|
| Frame processing latency | < 500ms per frame | Log inference time in `pipeline.py` |
| End-to-end alert latency | < 15 seconds | Timestamp when density crosses threshold vs. when alert appears in UI |
| Density estimation MAE | < 15% on test frames | Compare CSRNet output to manually counted frames |
| Dashboard heatmap refresh | ≥ 2 FPS visual update | Browser devtools — count paint events per second |
| Alert false positive rate | < 10% | Review alert log after demo scenario run |
| Guard assignment round-trip | < 2 seconds | Click assign → measure until GuardRoster updates |

---

## KEY EXTERNAL RESOURCES

- **CSRNet pretrained weights:** https://github.com/leeyeehoo/CSRNet-pytorch (download `partA_pre.h5` or `.pth`)
- **ShanghaiTech dataset (for test frames):** https://github.com/desenzhou/ShanghaiTechDataset
- **Crowd surge analysis methodology:** https://www.padme.ai/post/crowd-surge-analysis-c8a7f
- **FastAPI WebSocket docs:** https://fastapi.tiangolo.com/advanced/websockets/
- **Recharts docs:** https://recharts.org/en-US/api
- **Zustand docs:** https://docs.pmnd.rs/zustand/getting-started/introduction

---

## V2 BACKLOG (do not implement in hackathon)

- Live RTSP stream ingestion (replace simulator)
- Multi-camera support with unified venue map
- Drone/overhead view with homography correction
- Indoor stadium and concert hall venue presets
- Custom floor plan upload (admin draws zones over image)
- CSRNet fine-tuning on domain-specific footage
- Flow vector estimation (directional crowd movement)
- Predictive surge forecasting with LSTM
- Mobile-responsive guard dispatch interface
- SMS/push notification to guard devices
- Post-event analytics PDF export
- Role-based access (admin / guard / supervisor)