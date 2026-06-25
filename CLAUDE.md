# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EcoSentinel is a **Smart Meter Anomaly Detection System** — a full-stack app with a Python FastAPI backend and a React/TypeScript frontend. The backend runs a 6-stage ML detection pipeline on DLMS meter readings and optionally generates LLM explanations for anomalies via an async decision engine.

---

## Common Commands

### Backend

```bash
# Install dependencies
pip install -r requirements.txt

# Generate synthetic training data (one-time; writes to dataset/)
python dataset/generate_dataset.py

# Train all models (must run before starting API; rewrites models/)
python training/train.py

# Start API server (auto-reload on code changes)
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Hot-reload models after retraining without restarting the server
curl -X POST http://localhost:8000/model/reload
```

### Frontend

```bash
cd ecosentinel-frontend

npm install
cp .env.example .env   # set VITE_API_BASE_URL=http://localhost:8000

npm run dev      # Vite dev server at http://localhost:5173
npm run build    # TypeScript compile + Vite production bundle
npm run lint     # ESLint (zero warnings tolerance)
npm run preview  # Serve production build locally
```

### Testing

There is no automated test suite. Testing is manual:

```bash
# Health check
curl http://localhost:8000/health

# Model info
curl http://localhost:8000/model/info

# Detection (JSON payload examples in test_data_payloads.json)
curl -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d @test_data_payloads.json
```

---

## Architecture

### Backend Pipeline (`pipeline/`)

Each `POST /detect` request runs every record through **6 sequential stages**:

1. **OBIS Parser** (`obis_parser.py`) — splits pipe-delimited `rawValue` into structured readings
2. **Canonical Mapper** (`canonical_mapper.py`) — OBIS codes → canonical feature names (e.g., `voltage`, `energy_consumption`)
3. **Feature Engineer** (`feature_engineer.py`) — computes 19 features including rolling stats from DB history (last 10 readings)
4. **Rule-Based Detection** (`rule_based.py`) — 7 deterministic rules (negative energy, voltage out-of-range, etc.)
5. **Z-Score Detection** (`zscore_detector.py`) — fires on deviations > 3σ or > 4× ratio
6. **Isolation Forest** (`if_detector.py`) — routes to one of 6 per-capability-group models or global fallback

**Verdict rule:** `is_anomaly = True` if **any** layer fires (conservative; maximizes recall).

### Capability Group Model Routing

The backend has 6 Isolation Forest models (group_A through group_V), each trained on a specific subset of meter features, plus a global fallback:

- **Exact match** → use that group's model
- **Subset match** → use smallest superset group model
- **No match** → global fallback with NaN imputation

**Why per-group models?** A voltage-only meter imputed with a global median energy value would produce false anomaly signals. Group models are trained on clean data only.

### Configuration — Single Source of Truth

`config/settings.py` is where everything lives: OBIS registry, capability group definitions, feature schema, detection thresholds, rolling window size, Decision Engine config. **Any change to meter types, OBIS codes, or thresholds starts here.**

### Decision Engine (`decision_engine/`)

When an anomaly is flagged, an async background task calls an LLM (Ollama or OpenAI via `litellm`) to generate a human-readable explanation. This does **not** block the `/detect` response. The frontend polls `GET /anomalies/{id}/explanation` until `explanation_status` moves from `pending` → `completed` or `failed`.

### Database (`db/`)

Three PostgreSQL tables:
- `raw_meter_readings` — immutable audit trail of every raw record
- `meter_telemetry` — parsed canonical features (used for rolling-window history)
- `anomaly_log` — flagged anomalies + LLM explanation fields

**DB is optional** — the API degrades gracefully if PostgreSQL is unavailable (history-based features will be absent, but rule-based and IF detection still run).

### Frontend (`ecosentinel-frontend/`)

React 18 + Vite + TypeScript SPA with three pages (React Router v6):
- `/detect` — POST /detect form + results
- `/explain` — Enter anomaly ID, poll for LLM explanation
- `/ops` — Health check, model info, model reload

State is managed with **Zustand + Immer**. Components use **Radix UI** (accessible headless primitives) styled with **Tailwind CSS**.

---

## Key Paths

| Purpose | Path |
|---|---|
| API entry point | `api/main.py` |
| Pipeline orchestrator | `pipeline/__init__.py` |
| All config/thresholds | `config/settings.py` |
| DB schema | `db/schema.sql` |
| Frontend entry | `ecosentinel-frontend/src/App.tsx` |
| Frontend env template | `ecosentinel-frontend/.env.example` |
| Test payloads | `test_data_payloads.json` |
| Trained model artifacts | `models/` (gitignored; must run `training/train.py`) |
