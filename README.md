# CrowdShield

CrowdShield is an AI-powered crowd safety platform designed to detect and respond to crowd surge risk in real time. The system processes a simulated camera feed with a CSRNet-based density estimation model, maps crowd intensity onto a zone grid, and classifies each zone into graduated safety states (`safe`, `watch`, `warning`, `critical`) based on density and growth trends.

The project combines a Python backend for ML inference, alert logic, and incident APIs with a React dashboard for live monitoring and security operations. Operators can view heatmap-driven risk levels, track incident activity, and coordinate guard dispatch before local congestion escalates into dangerous crowd events.

## Run locally

Use two terminals from the **repository root**.

**Backend** (API on [http://127.0.0.1:8000](http://127.0.0.1:8000)):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend** (Vite dev server, typically [http://localhost:5173](http://localhost:5173)):

```bash
cd frontend
npm install
npm run dev
```
