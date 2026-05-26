# Smart Meter Anomaly Detection System

A production-ready anomaly detection service for smart meter telemetry. The system ingests raw DLMS/COSEM meter payloads, parses OBIS-coded readings, engineers features, and runs a three-layer detection pipeline — rule-based, statistical, and ML-based — before persisting results and serving them through a REST API.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Data Flow — End to End](#3-data-flow--end-to-end)
4. [Configuration — `config/settings.py`](#4-configuration--configsettingspy)
5. [Dataset Generation — `dataset/generate_dataset.py`](#5-dataset-generation--datasetgenerate_datasetpy)
6. [Training — `training/train.py`](#6-training--trainingtrainpy)
7. [Pipeline — `pipeline/`](#7-pipeline--pipeline)
   - [Stage 1 — OBIS Parser](#stage-1--obis-parser)
   - [Stage 2 — Canonical Mapper](#stage-2--canonical-mapper)
   - [Stage 3 — Feature Engineer](#stage-3--feature-engineer)
   - [Stage 4 — Rule-Based Detection](#stage-4--rule-based-detection)
   - [Stage 5 — Z-Score Detection](#stage-5--z-score-detection)
   - [Stage 6 — Isolation Forest Detection](#stage-6--isolation-forest-detection)
   - [Pipeline Orchestrator](#pipeline-orchestrator)
8. [Database — `db/`](#8-database--db)
   - [Table: raw_meter_readings](#table-raw_meter_readings)
   - [Table: meter_telemetry](#table-meter_telemetry)
   - [Table: anomaly_log](#table-anomaly_log)
   - [DB Client](#db-client)
9. [API — `api/`](#9-api--api)
   - [POST /detect](#post-detect)
   - [GET /health](#get-health)
   - [GET /model/info](#get-modelinfo)
   - [POST /model/reload](#post-modelreload)
10. [Model Artifacts — `models/`](#10-model-artifacts--models)
11. [Capability Groups and Model Routing](#11-capability-groups-and-model-routing)
12. [Feature Schema Reference](#12-feature-schema-reference)
13. [OBIS Code Registry](#13-obis-code-registry)
14. [Detection Thresholds Reference](#14-detection-thresholds-reference)
15. [Setup and Running](#15-setup-and-running)
16. [Testing Guide — curl Commands](#16-testing-guide--curl-commands)
17. [Training Evaluation — Metrics](#17-training-evaluation--metrics)
18. [Design Decisions](#18-design-decisions)
19. [What Is Not Yet Built](#19-what-is-not-yet-built)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        HES / Meter API                          │
│   Sends raw DLMS payloads in pipe-delimited OBIS format         │
└───────────────────────────┬─────────────────────────────────────┘
                            │  POST /detect  (JSON array of records)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FastAPI Service                          │
│                          api/main.py                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Detection Pipeline                          │
│                                                                 │
│   ┌─────────────────┐                                           │
│   │  OBIS Parser    │  Parse pipe-string → structured readings  │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ Canonical Mapper│  OBIS codes → canonical feature names     │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │Feature Engineer │  Compute derived features (energy        │
│   │                 │  optional — fallback to current/voltage)  │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │  Rule-Based     │  Deterministic checks                     │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │  Z-Score        │  Statistical deviation checks             │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│   ┌──────────────────────────────────────────┐                  │
│   │  Isolation Forest — Group Router         │                  │
│   │                                          │                  │
│   │  present features → resolve group        │                  │
│   │       ↓ exact/subset match               │                  │
│   │  group_A / group_B / ... / group_V       │                  │
│   │       ↓ no match                         │                  │
│   │  global fallback (NaN imputation)        │                  │
│   └────────┬─────────────────────────────────┘                  │
│            ▼                                                    │
│        PipelineResult  (is_anomaly + per-layer details          │
│                         + model_used + features_used)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌─────────────────┐         ┌─────────────────────┐
   │   PostgreSQL    │         │   API Response      │
   │  (3 tables)     │         │  (JSON to caller)   │
   └─────────────────┘         └─────────────────────┘
```

The service is stateless at the HTTP layer — every request carries its full context. State (meter history) lives in PostgreSQL and is fetched per request. Energy consumption is **not required** — the pipeline processes any combination of available parameters.

---

## 2. Project Structure

```
meter_anomaly/
│
├── config/
│   └── settings.py              ← Single source of truth for all constants,
│                                   OBIS registry, capability groups, thresholds
│
├── dataset/
│   └── generate_dataset.py      ← Synthetic data generator (training only)
│
├── training/
│   └── train.py                 ← Trains one IF per capability group + global
│                                   fallback; 80/20 split; full evaluation metrics
│
├── db/
│   ├── schema.sql               ← PostgreSQL table definitions
│   └── client.py                ← Connection pool + all query helpers
│
├── pipeline/
│   ├── __init__.py              ← Orchestrator (run() function)
│   ├── obis_parser.py           ← Parses rawValue pipe-string
│   ├── canonical_mapper.py      ← OBIS codes → canonical names
│   ├── feature_engineer.py      ← Computes all derived features;
│   │                               energy optional, falls back to current/voltage
│   ├── rule_based.py            ← Layer 1: deterministic checks
│   ├── zscore_detector.py       ← Layer 2: statistical checks
│   └── if_detector.py           ← Layer 3: group-routed IF inference
│
├── models/                      ← Generated by training/train.py
│   ├── isolation_forest.joblib  ← Global fallback model
│   ├── scaler.joblib
│   ├── impute_values.joblib
│   ├── feature_schema.joblib
│   ├── group_A/                 ← Per-group model artifacts
│   │   ├── isolation_forest.joblib
│   │   ├── scaler.joblib
│   │   └── feature_schema.joblib
│   ├── group_B/
│   ├── group_C/
│   ├── group_D/
│   ├── group_E/
│   └── group_V/
│
└── api/
    ├── __init__.py
    ├── main.py                  ← FastAPI app + all endpoints
    └── schemas.py               ← Pydantic request/response models
```

---

## 3. Data Flow — End to End

Understanding what happens to a single meter reading from arrival to stored result.

### What the HES sends

The Head End System sends an array of records. Each record represents one load-survey interval for one meter:

```json
{
  "id": 449618,
  "meterSerial": "E0000002",
  "timestamp": "2025-11-12T04:38:09.523241+00:00",
  "obisCode": "1.0.99.1.0.255",
  "entryId": 5,
  "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,225.91,V|3,1.0.1.29.0.255,2,0,Wh|4,1.0.11.27.0.255,2,0,A"
}
```

The `timestamp` field is when the API received the data. The actual **measurement time** is buried inside `rawValue` — it is the value of the clock object (`0.0.1.0.0.255`), which in this case is `2025-11-12 10:00:00`. These two timestamps can differ significantly when a meter reconnects after a communication gap.

### What `rawValue` contains

The `rawValue` is a pipe-delimited string where each segment represents one captured object:

```
{sequence},{obis_code},{attribute},{value},{unit}
```

Breaking down the example above:

| Segment | Sequence | OBIS Code | Attribute | Value | Unit |
|---|---|---|---|---|---|
| `1,0.0.1.0.0.255,2,2025-11-12 10:00:00,` | 1 | `0.0.1.0.0.255` | 2 | `2025-11-12 10:00:00` | *(empty)* |
| `2,1.0.12.27.0.255,2,225.91,V` | 2 | `1.0.12.27.0.255` | 2 | `225.91` | V |
| `3,1.0.1.29.0.255,2,0,Wh` | 3 | `1.0.1.29.0.255` | 2 | `0` | Wh |
| `4,1.0.11.27.0.255,2,0,A` | 4 | `1.0.11.27.0.255` | 2 | `0` | A |

Segment 1 is always the clock object — the interval timestamp. Segments 2+ are the actual measurements.

### The transformation chain

```
rawValue (pipe string)
    ↓  obis_parser.py
{
  "interval_timestamp": "2025-11-12 10:00:00",
  "readings": {
    "1.0.12.27.0.255": {"value": 225.91, "unit": "V"},
    "1.0.1.29.0.255":  {"value": 0.0,    "unit": "Wh"},
    "1.0.11.27.0.255": {"value": 0.0,    "unit": "A"}
  }
}
    ↓  canonical_mapper.py
{
  "voltage":            225.91,
  "energy_consumption": 0.0,
  "current":            0.0
}
    ↓  feature_engineer.py  (+ DB history, energy optional)
{
  "energy_consumption": 0.0,    ← None if absent; pipeline continues
  "hour_of_day":        10,
  "rolling_mean":       1.52,   ← computed from energy if present,
  "z_score":           -19.0,     else from current or voltage
  "voltage":            225.91,
  "voltage_deviation":  -4.09,
  ...
}
    ↓  group router in if_detector.py
    present raw features = {energy_consumption, voltage, current}
    → exact match → group_A model
    ↓  rule_based → zscore_detector → group_A IF model
PipelineResult(
  is_anomaly=True,
  isolation_forest={"model_used": "group_A", "anomaly_score": -0.21}
)
    ↓  DB persistence + API response
```

---

## 4. Configuration — `config/settings.py`

**This is the single source of truth for the entire system.** Nothing is hardcoded anywhere else — every threshold, path, OBIS mapping, capability group, and feature name comes from here.

### Database connection

```python
DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "meter_anomaly"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}
```

All values are overridable via environment variables. No credentials are hardcoded.

### Model artifact paths

```python
MODEL_PATHS = {
    "isolation_forest": "models/isolation_forest.joblib",   # global fallback
    "scaler":           "models/scaler.joblib",
    "impute_values":    "models/impute_values.joblib",
    "feature_schema":   "models/feature_schema.joblib",
}

def group_model_paths(group_name: str) -> dict:
    # Returns paths under models/<group_name>/
```

Each capability group has its own subdirectory under `models/`. The helper `group_model_paths("group_A")` returns the three artifact paths for that group.

### OBIS Registry

The registry is the authoritative map between OBIS codes and canonical feature names. To add support for a new OBIS code, add one entry here — nothing else in the codebase needs to change.

```python
OBIS_REGISTRY = {
    "1.0.1.29.0.255": {
        "canonical_name": "energy_consumption",
        "description":    "Active import energy – interval (Wh)",
        "unit":           "Wh",
        "is_timestamp":   False,
    },
    ...
}
```

### Capability Groups

```python
CAPABILITY_GROUPS = {
    "group_A": frozenset(["energy_consumption", "voltage", "current", "power_factor"]),
    "group_B": frozenset(["energy_consumption", "apparent_import_energy", "voltage"]),
    "group_C": frozenset(["energy_consumption", "current"]),
    "group_D": frozenset(["energy_consumption", "active_export_energy",
                           "apparent_import_energy", "voltage", "current",
                           "power_factor", "frequency"]),
    "group_E": frozenset(["energy_consumption"]),
    "group_V": frozenset(["voltage", "current"]),   # no energy
}
```

Each group defines the **exact set of raw canonical features** that a meter in that group exposes. This drives both model training (which data rows belong to which group) and inference routing (which model to call for a given payload). See [Section 11](#11-capability-groups-and-model-routing) for full details.

**To add a new capability group for a real-world meter profile:** add one entry to `CAPABILITY_GROUPS`, re-run `training/train.py`. No other file needs to change.

### Derived Feature Map

```python
DERIVED_FEATURE_MAP = {
    "energy_consumption": ["delta", "rolling_mean", "rolling_std",
                            "z_score", "spike_ratio",
                            "historical_avg_same_hour",
                            "historical_avg_same_day_type"],
    "current":            ["current_delta"],
    "voltage":            ["voltage_deviation"],
    "power_factor":       ["power_factor_deviation"],
    "_timestamp":         ["hour_of_day", "day_of_week", "is_weekend", "holiday"],
}
```

Used by both the training script and the group router in `if_detector.py` to deterministically build the feature list for each group. Adding a new raw feature and its derived features here means both training and inference automatically pick them up.

### Feature schema

```python
CORE_FEATURES    = [12 features — always present in global model]
OPTIONAL_FEATURES = [7 features — NaN-imputed in global model only]
ALL_FEATURES     = CORE_FEATURES + OPTIONAL_FEATURES  # 19 total (global fallback)
```

Per-group models use only their group's features + derived, not `ALL_FEATURES`.

### Detection thresholds

```python
DETECTION_CONFIG = {
    "zscore_threshold": 3.0,
    "voltage_min":      180.0,
    "voltage_max":      270.0,
    "power_factor_min": 0.0,
    "power_factor_max": 1.0,
    "if_contamination": 0.05,
}
```

---

## 5. Dataset Generation — `dataset/generate_dataset.py`

**Purpose:** Generate synthetic meter data that mirrors the real API payload format for model training. This is only used during training, never at inference.

**Run:**
```bash
python dataset/generate_dataset.py
```

**What it generates:**

- 10 simulated meters, each randomly assigned one of 5 OBIS-code capability profiles (matching `METER_CAPABILITY_PROFILES` in settings)
- 15 days of 30-minute interval data = 720 readings per meter = **7,200 rows total**
- Each row's `raw_data` is a JSON string keyed by OBIS codes, exactly as it would be stored in the DB after parsing

**Anomalies injected:**

| Anomaly Type | Probability | Method |
|---|---|---|
| Energy spike | 2% of readings | Multiply base consumption by 3–8× |
| Negative energy | 0.5% of readings | Multiply by -1 |

These match the `contamination=0.05` (5%) used when training Isolation Forest.

**Capability profiles simulated:**

| Profile | OBIS Codes | Maps to group |
|---|---|---|
| A | energy + voltage + current + power factor | `group_A` |
| B | energy + apparent energy + voltage | `group_B` |
| C | energy + current | `group_C` |
| D | Full set (energy + export + apparent + voltage + current + PF + frequency) | `group_D` |
| E | Energy only | `group_E` |

Note: `group_V` (voltage + current, no energy) is defined in settings but not simulated in the synthetic dataset — it is included for real-world meters that send only power quality parameters.

---

## 6. Training — `training/train.py`

**Purpose:** Train one Isolation Forest per capability group and one global fallback model. Includes 80/20 train/test split and full evaluation metrics.

**Run:**
```bash
python training/train.py
```

### What it does step by step

**Step 1 — Load + Parse**
Reads the CSV, parses each `raw_data` JSON string, maps OBIS keys to canonical names.

**Step 2 — Feature engineering per meter**
Groups by `meter_serial`, sorts chronologically, and computes all derived features. Energy is **not required** — the primary series for rolling stats falls back to `current` then `voltage` if energy is absent.

**Step 3 — 80/20 train/test split at meter level**
All readings for a given meter stay in the same split. This prevents temporal data leakage — a meter's history must never appear in both train and test.

```
8 meters → training data
2 meters → test data
```

**Step 4 — Train per-group models**

For each group in `CAPABILITY_GROUPS`:
1. Filter training rows to only meters whose present raw canonical features exactly match the group's `frozenset`
2. Build the feature list using `DERIVED_FEATURE_MAP` (raw features + all their derived features + time features)
3. Train an `IsolationForest` + `StandardScaler` on only those features — **no NaN columns, no imputation**
4. Evaluate on matched test meters if any exist
5. Save artifacts to `models/<group_name>/`

**Step 5 — Train global fallback model**
Trained on all data with all `ALL_FEATURES` columns. Missing optional features are filled with column medians (`impute_values.joblib`). This is the safety net for payloads that don't match any defined group.

### Pseudo-label reconstruction for evaluation

Since Isolation Forest is unsupervised (no ground truth labels in real data), labels are reconstructed from the known injection logic:

```
energy < 0            → label = 1 (anomaly — injected negative)
energy > 5 × rolling_mean → label = 1 (anomaly — injected spike)
all other rows        → label = 0 (normal)
```

### Saved artifacts

**Global model** (`models/`):

| File | What it is |
|---|---|
| `isolation_forest.joblib` | Trained IsolationForest on all 19 features |
| `scaler.joblib` | StandardScaler fitted on all 19 features |
| `impute_values.joblib` | Per-feature medians for NaN imputation |
| `feature_schema.joblib` | `{all_features, core_features, optional_features}` |

**Per-group models** (`models/<group_name>/`):

| File | What it is |
|---|---|
| `isolation_forest.joblib` | IsolationForest trained only on this group's features |
| `scaler.joblib` | StandardScaler fitted on this group's features only |
| `feature_schema.joblib` | `{features: [...], group_name, raw_features}` |

**All four global artifacts and all three per-group artifacts for a given run must stay in sync.** Never replace one without replacing all from the same training run.

---

## 7. Pipeline — `pipeline/`

The pipeline is a linear sequence of six stages. Each stage has a single responsibility and a clean input/output contract. Failures at any stage return a safe error result without crashing the service. **Energy consumption is not required** — the pipeline processes any combination of available OBIS parameters.

### Stage 1 — OBIS Parser
**File:** `pipeline/obis_parser.py`

**Input:** Raw API record dict
**Output:** Structured dict with `interval_timestamp` and `readings`

```python
# Output
{
  "interval_timestamp": "2025-11-12 10:00:00",
  "readings": {
    "1.0.12.27.0.255": {"value": 225.91, "unit": "V"},
    "1.0.1.29.0.255":  {"value": 0.0,    "unit": "Wh"},
    "1.0.11.27.0.255": {"value": 0.0,    "unit": "A"}
  }
}
```

Entry 1 (clock object, OBIS `0.0.1.0.0.255`) is extracted as `interval_timestamp`, not as a measurement. Malformed pipe entries log a warning and are skipped — partial payloads still process.

### Stage 2 — Canonical Mapper
**File:** `pipeline/canonical_mapper.py`

**Input:** `readings` dict (OBIS-keyed)
**Output:** Canonical feature dict (feature-name-keyed)

Reads from `OBIS_REGISTRY` in `settings.py`. Unknown OBIS codes produce a one-time warning and are skipped. The canonical dict is what gets stored in `meter_telemetry.raw_data` (JSONB).

### Stage 3 — Feature Engineer
**File:** `pipeline/feature_engineer.py`

**Input:** Canonical dict + interval timestamp + list of past DB readings
**Output:** Feature dict (all `ALL_FEATURES` keys; absent features are `None`)

**Energy is not required.** The feature engineer uses a primary series priority to compute rolling statistics:

```
PRIMARY_SERIES_PRIORITY = ["energy_consumption", "current", "voltage"]
```

The first available parameter is used as the primary series for `delta`, `rolling_mean`, `rolling_std`, `z_score`, and `spike_ratio`. If none of the three are available, those features become `None`.

Historical averages (`historical_avg_same_hour`, `historical_avg_same_day_type`) use `energy_consumption` when available, otherwise fall back to the primary series key.

Optional derived features degrade gracefully:

| Feature | Computed when |
|---|---|
| `delta`, `rolling_*`, `z_score`, `spike_ratio` | Any of energy/current/voltage is present |
| `voltage_deviation` | `voltage` is present |
| `current_delta` | `current` is present + history exists |
| `power_factor_deviation` | `power_factor` is present |
| `historical_avg_*` | Any primary series is present + history exists |
| Time features | Always (from interval timestamp) |

### Stage 4 — Rule-Based Detection
**File:** `pipeline/rule_based.py`

**Input:** Feature dict
**Output:** `RuleBasedResult`

| Rule | Condition | Violation ID |
|---|---|---|
| Negative energy | `energy_consumption < 0` | `negative_energy` |
| Zero flat-line | `energy == 0.0` AND `rolling_std < 0.01` | `zero_consumption` |
| Voltage too low | `voltage < 180V` | `voltage_too_low` |
| Voltage too high | `voltage > 270V` | `voltage_too_high` |
| Power factor invalid | `pf < 0` or `pf > 1` | `power_factor_out_of_range` |
| Negative current | `current < 0` | `negative_current` |
| Frequency abnormal | `frequency < 49Hz` or `> 51Hz` | `frequency_out_of_range` |

Rules only fire when the relevant feature is present (not `None`). A meter with no voltage will never trigger voltage rules.

### Stage 5 — Z-Score Detection
**File:** `pipeline/zscore_detector.py`

**Input:** Feature dict
**Output:** `ZScoreResult`

Two complementary signals:

| Trigger | Condition |
|---|---|
| `zscore_spike` | z_score > 3.0 |
| `zscore_drop` | z_score < -3.0 |
| `extreme_spike_ratio` | spike_ratio > 4.0× rolling mean |
| `extreme_drop_ratio` | spike_ratio < 0.1× rolling mean |

When energy is absent, `z_score` and `spike_ratio` are computed from the primary fallback series (current or voltage), so statistical anomalies are still detectable even without energy data.

### Stage 6 — Isolation Forest Detection
**File:** `pipeline/if_detector.py`

**Input:** Feature dict + original canonical dict
**Output:** `IFResult` (is_anomaly, anomaly_score, prediction, model_used, features_used)

This stage implements **automatic group routing**. See [Section 11](#11-capability-groups-and-model-routing) for the full routing logic.

The response includes two new fields:
- `model_used` — which group model was selected, or `"global"` for the fallback
- `features_used` — exact list of features that model was evaluated on

### Pipeline Orchestrator
**File:** `pipeline/__init__.py`

Wires all six stages in sequence. Key behaviours:

- **Empty canonical dict** → returns error (no OBIS codes recognised at all)
- **Energy absent** → logs INFO and continues; pipeline does not block
- **Feature engineering failure** → returns error result, `is_anomaly=False`
- **IF model missing** → logs error, skips IF layer, verdict based on rule + zscore only
- **Overall verdict** — `is_anomaly=True` if **any** layer fires

---

## 8. Database — `db/`

### Database setup

CREATE DATABASE meter_anomaly;

CREATE USER meter_user WITH PASSWORD 'meter_pass';

GRANT ALL PRIVILEGES ON DATABASE meter_anomaly TO meter_user;

\c meter_anomaly

GRANT USAGE, CREATE ON SCHEMA public TO meter_user;

### Why three tables

1. `raw_meter_readings` — immutable audit log, never modified after insert
2. `meter_telemetry` — operational store, queried at inference time for rolling features
3. `anomaly_log` — detection output, used for dashboards and alerting

### Table: `raw_meter_readings`

Stores every API record verbatim, exactly as received. Nothing is parsed or transformed.

```sql
CREATE TABLE raw_meter_readings (
    id                  BIGINT      PRIMARY KEY,
    meter_serial        VARCHAR(64) NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL,
    profile_obis_code   VARCHAR(32) NOT NULL,
    entry_id            INTEGER     NOT NULL,
    raw_value           TEXT        NOT NULL,
    CONSTRAINT uq_raw_reading UNIQUE (meter_serial, entry_id, received_at)
);
```

Stores the verbatim pipe-string so historical data can be re-parsed if the OBIS mapping changes.

### Table: `meter_telemetry`

Stores parsed, canonicalized readings. The operational table queried at inference for rolling feature history.

```sql
CREATE TABLE meter_telemetry (
    id                  BIGSERIAL   PRIMARY KEY,
    meter_serial        VARCHAR(64) NOT NULL,
    interval_timestamp  TIMESTAMPTZ NOT NULL,   -- from meter clock
    raw_data            JSONB       NOT NULL,   -- canonical feature dict
    received_at         TIMESTAMPTZ NOT NULL,
    source_raw_id       BIGINT      REFERENCES raw_meter_readings(id),
    CONSTRAINT uq_telemetry_interval UNIQUE (meter_serial, interval_timestamp)
);
```

**`raw_data` JSONB contents** — only raw electrical measurements, never derived features:

```json
{
  "energy_consumption": 1.6,
  "voltage": 230.1,
  "current": 1.4,
  "power_factor": 0.92
}
```

**Why derived features are excluded:** `delta`, `z_score`, `rolling_mean` etc. are recomputed fresh at inference time from raw values + fresh history. Storing them would cause stale derived values to corrupt future rolling calculations.

**Why `interval_timestamp` not `received_at`:** Rolling feature queries use `interval_timestamp` (the actual measurement time from the meter clock) to maintain correct temporal ordering, even when a meter reconnects and sends a backlog of readings out of API-receive order.

### Table: `anomaly_log`

Written whenever a reading is flagged anomalous.

```sql
CREATE TABLE anomaly_log (
    id                  BIGSERIAL   PRIMARY KEY,
    meter_serial        VARCHAR(64) NOT NULL,
    interval_timestamp  TIMESTAMPTZ NOT NULL,
    rule_based_flag     BOOLEAN     NOT NULL DEFAULT FALSE,
    zscore_flag         BOOLEAN     NOT NULL DEFAULT FALSE,
    if_flag             BOOLEAN     NOT NULL DEFAULT FALSE,
    if_score            FLOAT,
    zscore_value        FLOAT,
    rule_violations     JSONB,       -- e.g. ["negative_energy", "voltage_too_low"]
    feature_snapshot    JSONB,       -- full feature vector at detection time
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`feature_snapshot` stores the complete feature dict (including `model_used` context) allowing reconstruction of exactly what the model saw when the anomaly was flagged.

### DB Client
**File:** `db/client.py`

Uses `psycopg2.pool.SimpleConnectionPool` (min=1, max=10 connections). Key query:

```sql
-- get_last_n_readings()
SELECT interval_timestamp, raw_data
FROM meter_telemetry
WHERE meter_serial = %s
  AND interval_timestamp < %s
ORDER BY interval_timestamp DESC
LIMIT %s;
```

Returns results reversed to oldest→newest order as required by rolling feature computation.

---

## 9. API — `api/`

**Start the service:**
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive documentation: `http://localhost:8000/docs`

The API is DB-optional. If PostgreSQL is unreachable, detection still works — history comes back empty and rolling features degrade gracefully to a window of 1.

---

### POST /detect

**The main inference endpoint.**

**Request body:**
```json
{
  "records": [
    {
      "id": 449618,
      "meterSerial": "E0000002",
      "timestamp": "2025-11-12T04:38:09.523241+00:00",
      "obisCode": "1.0.99.1.0.255",
      "entryId": 5,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,225.91,V|3,1.0.1.29.0.255,2,1.6,Wh|4,1.0.11.27.0.255,2,1.4,A"
    }
  ]
}
```

**Response:**
```json
{
  "total": 1,
  "anomalies": 1,
  "results": [
    {
      "meter_serial": "E0000002",
      "interval_timestamp": "2025-11-12 10:00:00",
      "is_anomaly": true,
      "layers": {
        "rule_based": {
          "is_anomaly": false,
          "violations": [],
          "details": {}
        },
        "zscore": {
          "is_anomaly": true,
          "z_score": 8.34,
          "spike_ratio": 5.2,
          "triggers": ["zscore_spike"]
        },
        "isolation_forest": {
          "is_anomaly": true,
          "anomaly_score": -0.1831,
          "prediction": -1,
          "model_used": "group_A",
          "features_used": ["hour_of_day", "day_of_week", ..., "power_factor_deviation"]
        }
      },
      "features": { "energy_consumption": 8.1, ... },
      "error": null
    }
  ]
}
```

**New response fields (compared to previous version):**

| Field | Description |
|---|---|
| `layers.isolation_forest.model_used` | Which group model was used, or `"global"` |
| `layers.isolation_forest.features_used` | Exact feature list the model evaluated |

---

### GET /health

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "components": {
    "model_artifacts": "ok",
    "database": "ok"
  }
}
```

`"ok"` when all global model artifact files exist on disk. `"degraded"` if any are missing.

---

### GET /model/info

Returns feature schema, detection thresholds, rolling window size, and artifact paths.

```bash
curl http://localhost:8000/model/info
```

---

### POST /model/reload

Hot-reloads all model artifacts (global + all cached group models) from disk without restarting the service. Call this after retraining.

```bash
curl -X POST http://localhost:8000/model/reload
```

---

## 10. Model Artifacts — `models/`

### Global fallback model (`models/`)

| File | Type | Purpose |
|---|---|---|
| `isolation_forest.joblib` | IsolationForest | Predicts on all 19 features with imputation |
| `scaler.joblib` | StandardScaler | Fitted on all 19 features |
| `impute_values.joblib` | pandas.Series | Median per feature for NaN imputation |
| `feature_schema.joblib` | dict | `{all_features, core_features, optional_features}` |

### Per-group models (`models/<group_name>/`)

| File | Type | Purpose |
|---|---|---|
| `isolation_forest.joblib` | IsolationForest | Predicts on this group's features only |
| `scaler.joblib` | StandardScaler | Fitted on this group's features only |
| `feature_schema.joblib` | dict | `{features: [...], group_name, raw_features}` |

Group models have **no imputation** — they are trained only on features that are always present for that group.

---

## 11. Capability Groups and Model Routing

This section explains the full group system — how groups are defined, how models are trained per group, and how inference routes to the right model.

### Defined groups

| Group | Raw canonical features | Notes |
|---|---|---|
| `group_A` | energy + voltage + current + power_factor | Most common full-feature meter |
| `group_B` | energy + apparent_import_energy + voltage | Apparent energy meter |
| `group_C` | energy + current | Basic two-parameter meter |
| `group_D` | energy + export_energy + apparent_energy + voltage + current + PF + frequency | Full metering station |
| `group_E` | energy only | Minimal meter |
| `group_V` | voltage + current *(no energy)* | Power quality meter — energy absent |

### What each group model is trained on

Group models are trained on **raw features + all their derived features** as defined in `DERIVED_FEATURE_MAP`. Time features are always included. Example for `group_A`:

```
Time features:    hour_of_day, day_of_week, is_weekend, holiday
Energy + derived: energy_consumption, delta, rolling_mean, rolling_std,
                  z_score, spike_ratio, historical_avg_same_hour,
                  historical_avg_same_day_type
Voltage + derived: voltage, voltage_deviation
Current + derived: current, current_delta
PF + derived:      power_factor, power_factor_deviation
```

18 features total for `group_A`. No NaN columns. No imputation.

### Routing algorithm (`if_detector._resolve_group`)

```
present_raw_features = canonical_features - derived_features

1. Exact match   : present_raw_features == group_features  → use that group
2. Subset match  : present_raw_features ⊆ group_features
                   pick group with most overlap (smallest superset)
3. No match      : use global fallback with NaN imputation
```

The subset match handles real-world cases where a meter sends fewer parameters than its nominal profile (e.g. a group_A meter temporarily not reporting power factor). It finds the best available group rather than immediately falling back to global.

### Adding a new capability group for real-world data

**Only one file needs to change:** `config/settings.py`.

```python
# In CAPABILITY_GROUPS, add:
"group_X": frozenset([
    "energy_consumption",
    "reactive_import_energy",   # new parameter your meter sends
    "voltage",
]),
```

Then re-run:
```bash
python training/train.py
curl -X POST http://localhost:8000/model/reload
```

The training script automatically detects the new group, finds matching training rows, trains a model, and saves artifacts to `models/group_X/`. The router in `if_detector.py` picks it up on the next reload.

### Why per-group models instead of one global model with imputation

A single global model with median imputation has one fundamental problem: the imputed median is computed from all meters, including meters from different groups. When a `group_E` meter (energy only) is scored against a model trained partly on voltage and current data, the imputed voltage median introduces signal that was never present for that meter type. The model may flag that meter as anomalous simply because its "voltage" (actually the median from other meters) doesn't match the normal pattern for energy-only meters.

Per-group models eliminate this: a `group_E` meter is only scored against a model that has never seen voltage or current data at all. The anomaly score is based purely on the parameters that meter actually sends.

The global model is retained as a fallback for unclassified meter profiles encountered in production.

---

## 12. Feature Schema Reference

### Core Features (always present in global model)

| Feature | Description | Source |
|---|---|---|
| `energy_consumption` | Active import energy interval (Wh) | OBIS `1.0.1.29.0.255` |
| `hour_of_day` | Hour 0–23 | interval timestamp |
| `day_of_week` | 0=Monday … 6=Sunday | interval timestamp |
| `is_weekend` | 1 if Sat or Sun | derived from day_of_week |
| `holiday` | 1 if Sunday (proxy) | derived from day_of_week |
| `delta` | Change from previous reading | energy series |
| `rolling_mean` | Mean of last 5 primary-series readings | rolling window |
| `rolling_std` | Std dev of last 5 primary-series readings | rolling window |
| `z_score` | Std deviations from rolling mean | `(val - mean) / (std + ε)` |
| `spike_ratio` | Ratio to rolling mean | `val / (mean + ε)` |
| `historical_avg_same_hour` | Mean at this hour across all history | groupby hour |
| `historical_avg_same_day_type` | Mean on weekday/weekend across history | groupby is_weekend |

**Note:** When energy is absent, `delta`, `rolling_*`, `z_score`, `spike_ratio`, and `historical_avg_*` are computed from the first available primary series (`current` → `voltage`). They are `None` only when none of the three primary parameters are present.

### Optional Features (NaN-imputed in global model; native in group models)

| Feature | Description | Source |
|---|---|---|
| `voltage` | Line voltage (V) | OBIS `1.0.12.27.0.255` |
| `current` | Line current (A) | OBIS `1.0.11.27.0.255` |
| `power_factor` | Power factor (0–1) | OBIS `1.0.13.27.0.255` |
| `apparent_import_energy` | Apparent import energy (VAh) | OBIS `1.0.9.29.0.255` |
| `current_delta` | Change in current from previous reading | derived from current |
| `voltage_deviation` | Deviation from nominal 230V | `voltage - 230.0` |
| `power_factor_deviation` | Deviation from ideal PF | `1.0 - power_factor` |

---

## 13. OBIS Code Registry

| OBIS Code | Canonical Name | Description | Unit |
|---|---|---|---|
| `0.0.1.0.0.255` | *(timestamp)* | Interval clock object | — |
| `1.0.1.29.0.255` | `energy_consumption` | Active import energy – interval | Wh |
| `1.0.2.29.0.255` | `active_export_energy` | Active export energy – interval | Wh |
| `1.0.9.29.0.255` | `apparent_import_energy` | Apparent import energy – interval | VAh |
| `1.0.10.29.0.255` | `apparent_export_energy` | Apparent export energy – interval | VAh |
| `1.0.3.29.0.255` | `reactive_import_energy` | Reactive import energy – interval | VARh |
| `1.0.4.29.0.255` | `reactive_export_energy` | Reactive export energy – interval | VARh |
| `1.0.1.27.0.255` | `active_import_power` | Active import power | W |
| `1.0.2.27.0.255` | `active_export_power` | Active export power | W |
| `1.0.12.27.0.255` | `voltage` | Line voltage | V |
| `1.0.11.27.0.255` | `current` | Line current | A |
| `1.0.13.27.0.255` | `power_factor` | Power factor | — |
| `1.0.14.27.0.255` | `frequency` | Frequency | Hz |

To add a new OBIS code: add one entry to `OBIS_REGISTRY` in `config/settings.py`.

---

## 14. Detection Thresholds Reference

| Threshold | Value | Layer | What it controls |
|---|---|---|---|
| `zscore_threshold` | 3.0 | Z-score | Flags if \|z_score\| > 3.0 |
| `spike_ratio_threshold` | 4.0 | Z-score | Flags if primary series > 4× rolling mean |
| `drop_ratio_threshold` | 0.1 | Z-score | Flags if primary series < 10% of rolling mean |
| `voltage_min` | 180 V | Rule | Flags if voltage < 180V |
| `voltage_max` | 270 V | Rule | Flags if voltage > 270V |
| `power_factor_min` | 0.0 | Rule | Flags if PF < 0 |
| `power_factor_max` | 1.0 | Rule | Flags if PF > 1 |
| `frequency_min` | 49 Hz | Rule | Flags if frequency < 49Hz |
| `frequency_max` | 51 Hz | Rule | Flags if frequency > 51Hz |
| `if_contamination` | 0.05 | Training | Expected anomaly rate in training data |
| `rolling_window_size` | 10 | Inference | Past readings fetched from DB per meter |

---

## 15. Setup and Running

### 1. Install dependencies

```bash
pip install fastapi uvicorn psycopg2-binary scikit-learn pandas numpy joblib pydantic
```

### 2. Set up PostgreSQL

```bash
psql -U postgres
```
```sql
CREATE DATABASE meter_anomaly;
CREATE USER meter_user WITH PASSWORD 'meter_pass';
GRANT ALL PRIVILEGES ON DATABASE meter_anomaly TO meter_user;
```

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=meter_anomaly
export DB_USER=meter_user
export DB_PASSWORD=meter_pass
```

### 3. Generate training data

```bash
cd meter_anomaly
python dataset/generate_dataset.py
# → dataset/dynamic_meter_anomaly_dataset.csv  (7200 rows)
```

### 4. Train all models

```bash
python training/train.py
```

Expected output (abbreviated):
```
[ 1/5 ] Loading and parsing dataset ...  7200 rows, 10 meters
[ 2/5 ] Engineering features per meter ...
[ 3/5 ] Splitting meters 80/20 (train/test) ...
        Train: 5760 rows (8 meters)
        Test:  1440 rows (2 meters)
[ 4/5 ] Training per-capability-group models ...
  ── group_A ── Saved → models/group_A/
  ── group_B ── Saved → models/group_B/
  ...
[ 5/5 ] Training global fallback model ...

EVALUATION SUMMARY
  Model        Precision   Recall     F1   ROC-AUC
  global          0.0364   0.2222  0.0625    0.9289
```

After training, `models/` should contain:
```
models/
  isolation_forest.joblib
  scaler.joblib
  impute_values.joblib
  feature_schema.joblib
  group_A/  group_B/  group_C/  group_D/  group_E/  group_V/
```

### 5. Start the API

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

The API will load all model artifacts, initialise DB schema, and start serving.

---

## 16. Testing Guide — curl Commands

### Health and model info

```bash
# Service liveness
curl http://localhost:8000/health | python3 -m json.tool

# Feature schema + thresholds
curl http://localhost:8000/model/info | python3 -m json.tool

# Hot-reload after retraining
curl -X POST http://localhost:8000/model/reload | python3 -m json.tool
```

---

### Group A — `energy + voltage + current + power_factor`

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 101, "meterSerial": "E_GRP_A_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.6,Wh|3,1.0.12.27.0.255,2,230.5,V|4,1.0.11.27.0.255,2,1.4,A|5,1.0.13.27.0.255,2,0.92,"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_A`

**Anomalous — negative energy + low voltage:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 102, "meterSerial": "E_GRP_A_ANOM",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.1.29.0.255,2,-4.8,Wh|3,1.0.12.27.0.255,2,155.0,V|4,1.0.11.27.0.255,2,9.1,A|5,1.0.13.27.0.255,2,0.88,"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violations: `negative_energy`, `voltage_too_low`

**Anomalous — power factor out of range:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 103, "meterSerial": "E_GRP_A_PF",
      "timestamp": "2025-11-12T11:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 3,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 11:00:00,|2,1.0.1.29.0.255,2,1.5,Wh|3,1.0.12.27.0.255,2,229.0,V|4,1.0.11.27.0.255,2,1.3,A|5,1.0.13.27.0.255,2,1.45,"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violation: `power_factor_out_of_range`

---

### Group B — `energy + apparent_import_energy + voltage`

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 201, "meterSerial": "E_GRP_B_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.8,Wh|3,1.0.9.29.0.255,2,2.1,VAh|4,1.0.12.27.0.255,2,231.0,V"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_B`

**Anomalous — voltage too high + energy spike:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 202, "meterSerial": "E_GRP_B_ANOM",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.1.29.0.255,2,18.5,Wh|3,1.0.9.29.0.255,2,19.2,VAh|4,1.0.12.27.0.255,2,278.0,V"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violation: `voltage_too_high` — zscore/IF also fire on spike

---

### Group C — `energy + current`

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 301, "meterSerial": "E_GRP_C_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.5,Wh|3,1.0.11.27.0.255,2,1.3,A"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_C`

**Anomalous — negative current + energy spike:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 302, "meterSerial": "E_GRP_C_ANOM",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.1.29.0.255,2,22.0,Wh|3,1.0.11.27.0.255,2,-3.5,A"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violation: `negative_current` — zscore fires on spike

---

### Group D — Full set (energy + export + apparent + voltage + current + PF + frequency)

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 401, "meterSerial": "E_GRP_D_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.7,Wh|3,1.0.2.29.0.255,2,0.1,Wh|4,1.0.9.29.0.255,2,2.0,VAh|5,1.0.12.27.0.255,2,230.2,V|6,1.0.11.27.0.255,2,1.5,A|7,1.0.13.27.0.255,2,0.94,|8,1.0.14.27.0.255,2,50.01,Hz"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_D`

**Anomalous — frequency out of range + high voltage:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 402, "meterSerial": "E_GRP_D_ANOM",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.1.29.0.255,2,1.6,Wh|3,1.0.2.29.0.255,2,0.1,Wh|4,1.0.9.29.0.255,2,1.9,VAh|5,1.0.12.27.0.255,2,271.0,V|6,1.0.11.27.0.255,2,1.4,A|7,1.0.13.27.0.255,2,0.91,|8,1.0.14.27.0.255,2,47.3,Hz"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violations: `voltage_too_high`, `frequency_out_of_range`

---

### Group E — `energy only`

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 501, "meterSerial": "E_GRP_E_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.4,Wh"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_E`

**Anomalous — energy spike:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 502, "meterSerial": "E_GRP_E_SPIKE",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.1.29.0.255,2,47.9,Wh"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — `model_used: group_E` — zscore/IF fire

**Anomalous — negative energy:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 503, "meterSerial": "E_GRP_E_NEG",
      "timestamp": "2025-11-12T11:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 3,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 11:00:00,|2,1.0.1.29.0.255,2,-2.1,Wh"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violation: `negative_energy`

---

### Group V — `voltage + current` (no energy at all)

**Normal:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 601, "meterSerial": "E_GRP_V_NORMAL",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,229.8,V|3,1.0.11.27.0.255,2,1.2,A"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: false` — `model_used: group_V` — `features.energy_consumption: null`

**Anomalous — voltage sag + negative current:**
```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 602, "meterSerial": "E_GRP_V_ANOM",
      "timestamp": "2025-11-12T10:30:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 2,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:30:00,|2,1.0.12.27.0.255,2,172.0,V|3,1.0.11.27.0.255,2,-2.8,A"
    }]
  }' | python3 -m json.tool
```
Expected: `is_anomaly: true` — violations: `voltage_too_low`, `negative_current` — `model_used: group_V`

---

### Global fallback — unclassified OBIS combination

Sends reactive energy OBIS codes that are registered but don't match any defined group exactly:

```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 701, "meterSerial": "E_FALLBACK",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.5,Wh|3,1.0.3.29.0.255,2,0.8,VARh|4,1.0.4.29.0.255,2,0.2,VARh"
    }]
  }' | python3 -m json.tool
```
Expected: `model_used: global` — reactive energies are registered OBIS codes but not in any defined `CAPABILITY_GROUPS`

---

### Batch — multiple groups in one request

```bash
curl -s -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [
      {
        "id": 801, "meterSerial": "E_BATCH_A",
        "timestamp": "2025-11-12T10:00:00+00:00",
        "obisCode": "1.0.99.1.0.255", "entryId": 1,
        "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.6,Wh|3,1.0.12.27.0.255,2,230.0,V|4,1.0.11.27.0.255,2,1.4,A|5,1.0.13.27.0.255,2,0.91,"
      },
      {
        "id": 802, "meterSerial": "E_BATCH_E",
        "timestamp": "2025-11-12T10:00:00+00:00",
        "obisCode": "1.0.99.1.0.255", "entryId": 2,
        "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,-3.0,Wh"
      },
      {
        "id": 803, "meterSerial": "E_BATCH_V",
        "timestamp": "2025-11-12T10:00:00+00:00",
        "obisCode": "1.0.99.1.0.255", "entryId": 3,
        "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,229.5,V|3,1.0.11.27.0.255,2,1.1,A"
      },
      {
        "id": 804, "meterSerial": "E_BATCH_D",
        "timestamp": "2025-11-12T10:00:00+00:00",
        "obisCode": "1.0.99.1.0.255", "entryId": 4,
        "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.1.29.0.255,2,1.7,Wh|3,1.0.2.29.0.255,2,0.1,Wh|4,1.0.9.29.0.255,2,2.0,VAh|5,1.0.12.27.0.255,2,285.0,V|6,1.0.11.27.0.255,2,1.5,A|7,1.0.13.27.0.255,2,0.93,|8,1.0.14.27.0.255,2,50.02,Hz"
      }
    ]
  }' | python3 -m json.tool
```
Expected: `total: 4` — `anomalies: 2` — `E_BATCH_E` (negative energy, `group_E`) and `E_BATCH_D` (voltage_too_high, `group_D`) flagged

---

### What to look for in each response

| Field | What to verify |
|---|---|
| `is_anomaly` | `false` for normal, `true` for anomalous |
| `layers.isolation_forest.model_used` | Matches the group for the OBIS codes sent |
| `layers.isolation_forest.features_used` | Only features relevant to that group |
| `layers.rule_based.violations` | Exact rule IDs that fired |
| `layers.zscore.triggers` | `zscore_spike`, `zscore_drop`, `extreme_spike_ratio` |
| `layers.isolation_forest.anomaly_score` | Negative = anomalous; lower = more anomalous |
| `features.energy_consumption` | `null` for group_V — confirms energy-free path works |
| `features.z_score` | Non-null for group_V — computed from current (primary fallback) |

### Common issues

| Error | Cause | Fix |
|---|---|---|
| `FileNotFoundError: isolation_forest.joblib` | Models not trained | Run `training/train.py` first |
| `connection refused` | PostgreSQL not running | Start PostgreSQL — API still works without DB |
| `model_used: global` when you expect a group | Group model not trained or no exact/subset match | Check `CAPABILITY_GROUPS` in settings; re-run training |
| Import errors | Wrong working directory | Run from inside `meter_anomaly/` |

---

## 17. Training Evaluation — Metrics

### Why standard metrics are challenging for unsupervised anomaly detection

Isolation Forest is trained without labels. In production, ground truth anomaly labels do not exist. The evaluation metrics in `training/train.py` are based on **pseudo-labels** reconstructed from the known injection logic used during dataset generation:

```
energy < 0                      → label = 1 (anomaly — injected negative)
energy > 5 × rolling_mean       → label = 1 (anomaly — injected spike)
all other rows                  → label = 0 (normal)
```

This gives an approximate but not perfect ground truth — the injection thresholds (3–8× multiplication) may or may not cross the 5× pseudo-label boundary in every case.

### Metrics computed

| Metric | Description |
|---|---|
| Precision | Of all readings flagged anomalous, what fraction were truly anomalous |
| Recall | Of all truly anomalous readings, what fraction were correctly flagged |
| F1 Score | Harmonic mean of precision and recall |
| ROC-AUC | Area under the ROC curve using `decision_function` scores — measures ranking quality independent of threshold |
| Confusion matrix | TP / FP / TN / FN counts |

### Interpreting the results

**ROC-AUC is the most meaningful metric here.** It measures how well the model *ranks* anomalies above normal readings, independent of the contamination threshold. An AUC of 0.93 (as seen on the global model) means the model correctly ranks a randomly chosen anomaly above a randomly chosen normal reading 93% of the time — strong for an unsupervised model.

**Precision is expected to be low.** With `contamination=0.05`, the model flags 5% of all readings as anomalous. Since true anomalies are only ~2.5% of the data, some normal readings will be flagged (false positives). In a real deployment, the Decision Engine (Step 5) will add confidence scoring to filter high-confidence anomalies from borderline ones.

**Per-group metrics** are shown when test meters exist for that group. With only 10 synthetic meters split 80/20, some groups may show "no test meters" — this resolves naturally with a larger real-world dataset.

### Train/test split strategy

The split is performed at the **meter level**, not the row level. All readings for a given meter stay in the same split. Row-level splitting would leak temporal history across the boundary — a test reading's "rolling mean" would include training readings from the same meter, inflating evaluation metrics.

---

## 18. Design Decisions

**Single source of truth in `settings.py`**
Every OBIS mapping, capability group, threshold, feature name, and file path lives in one file. Adding a new OBIS code, adjusting a threshold, or defining a new capability group for real-world meters requires editing exactly one file.

**Per-group Isolation Forest models, not one global model**
A single model with NaN imputation has a fundamental flaw: imputed medians are computed across all meter types. A voltage-only meter scored against a model that "expects" energy data will have its imputed energy median treated as a real signal, potentially generating false positives or masking real anomalies. Per-group models eliminate this — each model only knows about the features its group actually exposes. The global model is retained only as a safety net for unclassified profiles.

**NaN imputation only in global fallback**
Group models are trained on clean feature matrices with no NaN columns. Imputation happens only in the global fallback, and only for optional features missing from a payload that didn't match any group.

**Energy consumption is not required**
Previously the pipeline blocked if energy was absent. This excluded voltage-only or current-only meter types entirely. Now the pipeline processes any combination of available parameters. Rolling statistics fall back to current, then voltage, as the primary series. Only a completely empty canonical dict (no recognised OBIS codes at all) blocks the pipeline.

**Primary series fallback for rolling statistics**
Rather than having separate rolling feature sets for each parameter, a single "primary series" is selected in priority order (energy → current → voltage). This keeps the feature engineering logic clean and consistent across all meter types. The model knows from training which parameter the rolling stats are based on (via the group's feature set).

**OBIS codes as keys in `raw_data` JSONB**
Storing raw data keyed by OBIS codes rather than canonical names means the DB is independent of the canonical mapping. If a canonical name changes, historical data does not need migration — only the mapping in `settings.py` changes.

**Derived features not stored in DB**
`delta`, `z_score`, `rolling_mean` etc. are computed at inference time from raw values plus fresh DB history. Storing them would cause stale computed values to corrupt future rolling calculations when neighbors are updated or gaps are backfilled.

**Meter-level train/test split**
Splitting at the meter level (not row level) prevents temporal data leakage. A meter's historical readings must never appear in both training and test sets.

**DB is optional at runtime**
If PostgreSQL is unavailable, detection still works — history comes back empty, rolling features use a window of 1 (current reading only). Persistence failures are logged but never surfaced to the caller. This makes the service resilient to DB maintenance windows.

**Conservative anomaly verdict**
`is_anomaly=True` if any layer fires. This maximises recall at the cost of higher false positive rate. The upcoming Decision Engine will add confidence scoring to let operators filter by severity and root cause.

---

## 19. What Is Not Yet Built

**Decision Engine (Step 5)**
The current pipeline outputs *that* an anomaly was detected. The Decision Engine will output *what* the anomaly probably is — assigning a category (meter tampering, power theft, sensor fault, communication failure, voltage spike, sudden consumption spike), a severity score, a confidence level, and a probable root cause by analysing which layers fired and which features drove the IF score.

**Kafka Integration**
The architecture supports a Kafka producer/consumer layer between the HES and the detection service. Currently the API accepts direct HTTP pushes. The pipeline module is already decoupled from the transport layer — adding a Kafka consumer that calls `pipeline.run()` requires only a new consumer script.

**Dashboard / HES Plugin**
No frontend is implemented. The `anomaly_log` and `meter_telemetry` tables are designed to back a dashboard showing live anomalies, meter-wise trends, voltage/current graphs, anomaly heatmaps, and historical analysis.

**Automated model retraining**
Retraining is currently manual: run `generate_dataset.py`, run `train.py`, call `POST /model/reload`. An automated pipeline would monitor data drift, trigger retraining on a schedule, validate metrics before promoting new models, and hot-reload automatically.

**Authentication**
The API has no authentication or rate limiting. All endpoints are publicly accessible.

**Automatic capability group discovery**
Currently, capability groups must be manually defined in `settings.py`. A future enhancement could analyse the OBIS codes seen from each meter over its first N readings and automatically propose a new group if no existing group matches.
