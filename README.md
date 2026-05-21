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
11. [Feature Schema Reference](#11-feature-schema-reference)
12. [OBIS Code Registry](#12-obis-code-registry)
13. [Detection Thresholds Reference](#13-detection-thresholds-reference)
14. [Setup and Running](#14-setup-and-running)
15. [Testing Guide](#15-testing-guide)
16. [Design Decisions](#16-design-decisions)
17. [What Is Not Yet Built](#17-what-is-not-yet-built)

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
│   │Feature Engineer │  Compute derived features + DB history    │
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
│   ┌─────────────────┐                                           │
│   │Isolation Forest │  ML multivariate anomaly detection        │
│   └────────┬────────┘                                           │
│            ▼                                                    │
│        PipelineResult  (is_anomaly + per-layer details)         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌─────────────────┐         ┌─────────────────────┐
   │   PostgreSQL    │         │   API Response      │
   │  (3 tables)     │         │  (JSON to caller)   │
   └─────────────────┘         └─────────────────────┘
```

The service is stateless at the HTTP layer — every request carries its full context. State (meter history) lives in PostgreSQL and is fetched per request.

---

## 2. Project Structure

```
meter_anomaly/
│
├── config/
│   └── settings.py              ← Single source of truth for all constants
│
├── dataset/
│   └── generate_dataset.py      ← Synthetic data generator (training only)
│
├── training/
│   └── train.py                 ← Trains Isolation Forest, saves 4 artifacts
│
├── db/
│   ├── schema.sql               ← PostgreSQL table definitions
│   └── client.py                ← Connection pool + all query helpers
│
├── pipeline/
│   ├── __init__.py              ← Orchestrator (run() function)
│   ├── obis_parser.py           ← Parses rawValue pipe-string
│   ├── canonical_mapper.py      ← OBIS codes → canonical names
│   ├── feature_engineer.py      ← Computes all derived features
│   ├── rule_based.py            ← Layer 1: deterministic checks
│   ├── zscore_detector.py       ← Layer 2: statistical checks
│   └── if_detector.py           ← Layer 3: Isolation Forest inference
│
├── models/                      ← Generated by training/train.py
│   ├── isolation_forest.joblib
│   ├── scaler.joblib
│   ├── impute_values.joblib
│   └── feature_schema.joblib
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
{ "interval_timestamp": "2025-11-12 10:00:00",
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
    ↓  feature_engineer.py  (+ DB history for this meter)
{
  "energy_consumption": 0.0,
  "hour_of_day": 10,
  "day_of_week": 2,
  "is_weekend": 0,
  "holiday": 0,
  "delta": -1.6,
  "rolling_mean": 1.52,
  "rolling_std": 0.08,
  "z_score": -19.0,
  "spike_ratio": 0.001,
  "voltage": 225.91,
  "voltage_deviation": -4.09,
  "current": 0.0,
  "current_delta": -1.4,
  ...
}
    ↓  rule_based → zscore_detector → if_detector
PipelineResult(
  is_anomaly=True,
  rule_based={"violations": ["zero_consumption"]},
  zscore={"triggers": ["zscore_drop"]},
  isolation_forest={"anomaly_score": -0.21}
)
    ↓  DB persistence + API response
```

---

## 4. Configuration — `config/settings.py`

**This is the single source of truth for the entire system.** Nothing is hardcoded anywhere else — every threshold, path, OBIS mapping, and feature name comes from here.

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
    "isolation_forest": "models/isolation_forest.joblib",
    "scaler":           "models/scaler.joblib",
    "impute_values":    "models/impute_values.joblib",
    "feature_schema":   "models/feature_schema.joblib",
}
```

Override the base directory with the `MODEL_DIR` environment variable.

### OBIS Registry

The registry is the authoritative map between OBIS codes and canonical feature names. Every other component in the system reads from this registry — nothing else needs to change when a new OBIS code is added.

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

To add support for a new OBIS code from a new meter model, add one entry here. No other file changes are needed.

### Feature schema

```python
CORE_FEATURES    = [12 features always present]
OPTIONAL_FEATURES = [7 features present only for capable meters]
ALL_FEATURES     = CORE_FEATURES + OPTIONAL_FEATURES  # 19 total
```

This defines the fixed 19-column vector the Isolation Forest is trained on and expects at inference time.

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

All thresholds are in one place and tunable without touching detection code.

---

## 5. Dataset Generation — `dataset/generate_dataset.py`

**Purpose:** Generate synthetic meter data that mirrors the real API payload format for model training. This is only used during training, never at inference.

**Run:**
```bash
python dataset/generate_dataset.py
```

**What it generates:**

- 10 simulated meters, each randomly assigned one of 5 capability profiles
- 15 days of 30-minute interval data = 720 readings per meter = **7,200 rows total**
- Each row in the CSV has: `id`, `meter_serial`, `received_at`, `profile_obis_code`, `entry_id`, `interval_timestamp`, `raw_data`
- `raw_data` is a JSON string with OBIS codes as keys, exactly as it would be stored in the DB after parsing

**Anomalies injected:**

| Anomaly Type | Probability | Method |
|---|---|---|
| Energy spike | 2% of readings | Multiply base consumption by 3–8× |
| Negative energy | 0.5% of readings | Multiply by -1 |

These match the `contamination=0.05` (5%) used when training the Isolation Forest.

**Capability profiles simulated:**

| Profile | Parameters |
|---|---|
| A | energy + voltage + current + power factor |
| B | energy + apparent energy + voltage |
| C | energy + current |
| D | Full set (energy + export energy + apparent energy + voltage + current + PF + frequency) |
| E | Energy only |

**Output CSV columns:**

| Column | Description |
|---|---|
| `id` | Auto-incrementing record ID (simulates API id) |
| `meter_serial` | e.g. `E0000001` through `E0000010` |
| `received_at` | Simulated API receive time (interval_ts + a few seconds) |
| `profile_obis_code` | Always `1.0.99.1.0.255` (load survey) |
| `entry_id` | Sequential entry number for this meter |
| `interval_timestamp` | Actual measurement time |
| `raw_data` | JSON string: `{"1.0.1.29.0.255": 1.6, "1.0.12.27.0.255": 230.1, ...}` |

---

## 6. Training — `training/train.py`

**Purpose:** Train the Isolation Forest model on the synthetic dataset and save four artifacts that the inference pipeline uses at runtime.

**Run:**
```bash
python training/train.py
```

### What it does step by step

**Step 1 — Load CSV**
Reads `dataset/dynamic_meter_anomaly_dataset.csv`.

**Step 2 — Parse and canonicalize**
Reads each row's `raw_data` JSON string, maps every OBIS code to its canonical name using `OBIS_REGISTRY`. The timestamp entry (`0.0.1.0.0.255`) is skipped — it is not a feature.

**Step 3 — Feature engineering per meter**
Groups by `meter_serial` and sorts chronologically. For each meter, computes all derived features in order:
- Time features: `hour_of_day`, `day_of_week`, `is_weekend`, `holiday`
- `delta`: change in energy from the previous reading
- `rolling_mean`, `rolling_std`: 5-reading rolling window on energy
- `z_score`: how many standard deviations this reading is from the local mean
- `spike_ratio`: ratio of current energy to rolling mean
- `voltage_deviation`: voltage minus nominal 230V
- `power_factor_deviation`: 1 minus power factor
- `historical_avg_same_hour`: average energy for this meter at this hour across all training data
- `historical_avg_same_day_type`: average energy for this meter on weekdays vs weekends

**Why per-meter and chronological?** Rolling features require temporal ordering. Mixing meters or computing out of order would produce meaningless rolling statistics.

**Step 4 — Build fixed 19-column feature matrix**
Adds any optional feature columns not present for a given meter as `NaN`, then imputes with the **column median** across all training data. Median is used instead of mean because the training data contains injected anomalies — outliers would skew a mean imputation.

**Step 5 — Scale and train**
`StandardScaler` normalises all features before training. While Isolation Forest is tree-based and technically doesn't require scaling, it improves anomaly score consistency across features with very different ranges (e.g. `energy_consumption` in Wh vs `voltage_deviation` in V).

`IsolationForest` parameters:
- `n_estimators=200`: 200 trees for stable anomaly scores
- `contamination=0.05`: tells the model to expect ~5% anomalies, matching the injection rate
- `random_state=42`: reproducible results

### Saved artifacts

| File | What it is | Why it is saved |
|---|---|---|
| `isolation_forest.joblib` | Trained sklearn IsolationForest | Makes predictions at inference |
| `scaler.joblib` | Fitted StandardScaler | Inference must scale using training statistics, not re-fit |
| `impute_values.joblib` | Pandas Series of per-feature medians | Inference must impute missing optional features using training medians |
| `feature_schema.joblib` | Dict with `all_features`, `core_features`, `optional_features` lists | Ensures inference always builds the feature vector in the exact same column order as training |

**The scaler and impute values must come from training — never re-fitted at inference.** Re-fitting would produce different scaling statistics per request, breaking model predictions.

---

## 7. Pipeline — `pipeline/`

The pipeline is a linear sequence of six stages. Each stage has a single responsibility and a clean input/output contract. Failures at any stage return a safe error result without crashing the service.

### Stage 1 — OBIS Parser
**File:** `pipeline/obis_parser.py`

**Input:** Raw API record dict (as received from HES)
**Output:** Structured dict with `interval_timestamp` and `readings`

```python
# Input
{
  "id": 449618,
  "meterSerial": "E0000002",
  "timestamp": "2025-11-12T04:38:09+00:00",
  "obisCode": "1.0.99.1.0.255",
  "entryId": 5,
  "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,225.91,V|..."
}

# Output
{
  "id": 449618,
  "meter_serial": "E0000002",
  "received_at": "2025-11-12T04:38:09+00:00",
  "profile_obis_code": "1.0.99.1.0.255",
  "entry_id": 5,
  "interval_timestamp": "2025-11-12 10:00:00",
  "readings": {
    "1.0.12.27.0.255": {"value": 225.91, "unit": "V"},
    "1.0.1.29.0.255":  {"value": 0.0,    "unit": "Wh"}
  }
}
```

**Key behaviour:**
- Entry 1 (clock object, OBIS `0.0.1.0.0.255`) is extracted as `interval_timestamp`, not as a measurement
- Malformed pipe entries log a warning and are skipped — partial payloads still process
- Raises `OBISParseError` only if the timestamp entry is completely missing or the payload is empty

### Stage 2 — Canonical Mapper
**File:** `pipeline/canonical_mapper.py`

**Input:** `readings` dict from Stage 1 (OBIS-keyed)
**Output:** Canonical feature dict (feature-name-keyed)

```python
# Input
{
  "1.0.12.27.0.255": {"value": 225.91, "unit": "V"},
  "1.0.1.29.0.255":  {"value": 1.6,    "unit": "Wh"}
}

# Output
{
  "voltage":            225.91,
  "energy_consumption": 1.6
}
```

**Key behaviour:**
- Reads from `OBIS_REGISTRY` in `settings.py` — no OBIS knowledge hardcoded here
- Unknown OBIS codes produce a **one-time warning** per code and are skipped gracefully (not errors)
- The one-time warning prevents log flooding when an unregistered meter sends thousands of readings

This canonical dict is what gets stored in `meter_telemetry.raw_data` (JSONB), providing a clean, human-readable representation in the database.

### Stage 3 — Feature Engineer
**File:** `pipeline/feature_engineer.py`

**Input:** Canonical dict + interval timestamp + list of past readings from DB
**Output:** Complete 19-feature dict (optional features are `None` if unavailable)

**Why history is needed at inference:**
Rolling features (`rolling_mean`, `rolling_std`, `z_score`) and historical averages require past readings for this meter. At inference, these cannot be computed from the current reading alone. The API fetches the last 10 readings from `meter_telemetry` and passes them here.

**Features computed:**

| Feature | Type | How computed |
|---|---|---|
| `energy_consumption` | Core | Directly from canonical dict |
| `hour_of_day` | Core | From interval timestamp |
| `day_of_week` | Core | 0=Monday … 6=Sunday |
| `is_weekend` | Core | 1 if day_of_week ≥ 5 |
| `holiday` | Core | 1 if Sunday (proxy) |
| `delta` | Core | energy − previous energy |
| `rolling_mean` | Core | Mean of last 5 energy readings |
| `rolling_std` | Core | Std dev of last 5 energy readings |
| `z_score` | Core | (energy − rolling_mean) / (rolling_std + ε) |
| `spike_ratio` | Core | energy / (rolling_mean + ε) |
| `historical_avg_same_hour` | Core | Mean energy at this hour across all history |
| `historical_avg_same_day_type` | Core | Mean energy on weekday/weekend across history |
| `voltage` | Optional | Directly from canonical dict |
| `current` | Optional | Directly from canonical dict |
| `power_factor` | Optional | Directly from canonical dict |
| `apparent_import_energy` | Optional | Directly from canonical dict |
| `current_delta` | Optional | current − previous current |
| `voltage_deviation` | Optional | voltage − 230.0 |
| `power_factor_deviation` | Optional | 1.0 − power_factor |

**Fallback when history is empty:** Rolling features use only the current reading (window of 1). Historical averages use the current energy value. The pipeline does not crash — it simply has reduced feature quality for the first few readings of a new meter.

**Derived features are NOT stored in `meter_telemetry.raw_data`.** Only the raw electrical values (energy, voltage, current, etc.) are stored. Derived features are always recomputed fresh at inference time from those raw values plus fresh DB history. This prevents stale computed values from polluting future rolling calculations.

### Stage 4 — Rule-Based Detection
**File:** `pipeline/rule_based.py`

**Input:** 19-feature dict
**Output:** `RuleBasedResult` (is_anomaly, violations list, details dict)

Detects obvious, deterministic anomalies that do not require ML and that ML might miss or flag less reliably:

| Rule | Condition | Violation ID |
|---|---|---|
| Negative energy | `energy_consumption < 0` | `negative_energy` |
| Zero flat-line | `energy == 0.0` AND `rolling_std < 0.01` | `zero_consumption` |
| Voltage too low | `voltage < 180V` | `voltage_too_low` |
| Voltage too high | `voltage > 270V` | `voltage_too_high` |
| Power factor invalid | `pf < 0` or `pf > 1` | `power_factor_out_of_range` |
| Negative current | `current < 0` | `negative_current` |
| Frequency abnormal | `frequency < 49Hz` or `> 51Hz` | `frequency_out_of_range` |

The zero-consumption rule is intentionally strict: it only fires when `rolling_std < 0.01`, meaning the meter has a historically non-zero baseline. A meter that normally reads zero (e.g. a commercial meter at night) will not be falsely flagged.

### Stage 5 — Z-Score Detection
**File:** `pipeline/zscore_detector.py`

**Input:** 19-feature dict
**Output:** `ZScoreResult` (is_anomaly, z_score, spike_ratio, triggers list)

Two complementary signals:

**Z-score threshold** — flags if |z_score| > 3.0
The z_score (computed in Stage 3) measures how many standard deviations the current reading is from its local rolling mean. A threshold of 3.0 means approximately 0.3% false positive rate under a normal distribution.

| Trigger | Condition |
|---|---|
| `zscore_spike` | z_score > 3.0 |
| `zscore_drop` | z_score < -3.0 |

**Spike ratio** — flags extreme multiplier anomalies
Complements z-score for flat-baseline meters. When `rolling_std ≈ 0` (meter consistently reads the same value), z-score becomes unreliable. Spike ratio catches anomalies in these cases:

| Trigger | Condition |
|---|---|
| `extreme_spike_ratio` | spike_ratio > 4.0× rolling mean |
| `extreme_drop_ratio` | spike_ratio < 0.1× rolling mean |

### Stage 6 — Isolation Forest Detection
**File:** `pipeline/if_detector.py`

**Input:** 19-feature dict
**Output:** `IFResult` (is_anomaly, anomaly_score, prediction)

**What Isolation Forest detects:**
Multivariate anomalies that cannot be caught by single-column checks — for example, voltage and current both gradually increasing while energy consumption stays flat, or a combination of features that is individually normal but collectively unusual.

**How inference works:**
1. Build the 19-column feature vector in the exact same column order as training (from `feature_schema.joblib`)
2. Impute any `None` optional features with the training medians (from `impute_values.joblib`)
3. Scale with the training `StandardScaler` (from `scaler.joblib`)
4. Call `model.predict()` → returns -1 (anomaly) or 1 (normal)
5. Call `model.decision_function()` → returns the anomaly score (lower = more anomalous)

**Model loading:** Artifacts are loaded once on first call (lazy singleton) and cached in module-level variables. Subsequent calls reuse the loaded model. `reload_artifacts()` forces a fresh load from disk.

### Pipeline Orchestrator
**File:** `pipeline/__init__.py`

**Input:** Raw API record dict + history list
**Output:** `PipelineResult`

Wires all six stages in sequence. Error handling philosophy:
- If OBIS parsing fails → return error result with `is_anomaly=False`
- If energy is missing from payload → return error result
- If feature engineering fails → return error result
- If Isolation Forest model is missing → log error, skip IF layer, verdict still based on rule + zscore layers
- **Errors never bubble up to the caller.** The service always returns a response.

**Overall verdict:** A reading is `is_anomaly=True` if **any** layer fires. This is intentionally conservative. The future Decision Engine (Step 5) will add confidence scoring and root cause analysis on top.

---

## 8. Database — `db/`

### Why three tables

The database separates three concerns that have different retention needs, different consumers, and different schemas:

1. **`raw_meter_readings`** — immutable audit log. Never modified after insert.
2. **`meter_telemetry`** — the operational store. Used at inference time for rolling features.
3. **`anomaly_log`** — detection output. Used for dashboards, alerting, and investigation.

### Table: `raw_meter_readings`

Stores every API record verbatim, exactly as received. Nothing is parsed or transformed here.

```sql
CREATE TABLE raw_meter_readings (
    id                  BIGINT      PRIMARY KEY,      -- API-supplied id
    meter_serial        VARCHAR(64) NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL,         -- when API received it
    profile_obis_code   VARCHAR(32) NOT NULL,         -- e.g. "1.0.99.1.0.255"
    entry_id            INTEGER     NOT NULL,
    raw_value           TEXT        NOT NULL,         -- verbatim pipe-string
    CONSTRAINT uq_raw_reading UNIQUE (meter_serial, entry_id, received_at)
);
```

**Why store the raw pipe-string?**
If the OBIS mapping or parsing logic changes in future, you can re-parse historical data without loss. It also serves as a forensic trail — if a parsing bug is discovered, you can replay the raw data through the corrected parser.

**Unique constraint:** `(meter_serial, entry_id, received_at)` prevents re-ingestion of duplicate API records when the HES resends data after a failure.

### Table: `meter_telemetry`

Stores the parsed, canonicalized representation of each reading. This is the operational table — read at inference time to provide history for rolling feature computation.

```sql
CREATE TABLE meter_telemetry (
    id                  BIGSERIAL   PRIMARY KEY,
    meter_serial        VARCHAR(64) NOT NULL,
    interval_timestamp  TIMESTAMPTZ NOT NULL,   -- from meter clock, NOT API receive time
    raw_data            JSONB       NOT NULL,   -- canonical feature dict
    received_at         TIMESTAMPTZ NOT NULL,
    source_raw_id       BIGINT      REFERENCES raw_meter_readings(id),
    CONSTRAINT uq_telemetry_interval UNIQUE (meter_serial, interval_timestamp)
);
```

**`interval_timestamp` vs `received_at`:**
`interval_timestamp` is extracted from OBIS entry 1 (the clock object) — it is when the meter actually made the measurement. `received_at` is when the API received the record. These differ when a meter reconnects after an outage and sends a backlog of historical readings. All rolling feature queries use `interval_timestamp` to maintain correct temporal ordering.

**`raw_data` JSONB contents:**
Only raw electrical measurements are stored here — the values that came directly from the meter:

```json
{
  "energy_consumption": 1.6,
  "voltage": 230.1,
  "current": 1.4,
  "power_factor": 0.92
}
```

**Derived features are deliberately excluded.** `delta`, `z_score`, `rolling_mean` etc. are NOT stored here. They are recomputed at inference time from the raw values plus fresh history. If they were stored and used as history, stale derived values would corrupt future feature engineering.

**Indexes:**
- `(meter_serial, interval_timestamp DESC)` — the primary query pattern: "last N readings for meter X"
- GIN index on `raw_data` — supports JSONB queries like filtering by which features are present

**Unique constraint:** `(meter_serial, interval_timestamp)` prevents duplicate interval entries per meter. The API uses `ON CONFLICT DO NOTHING`.

### Table: `anomaly_log`

Written by the detection pipeline whenever a reading is flagged anomalous.

```sql
CREATE TABLE anomaly_log (
    id                  BIGSERIAL   PRIMARY KEY,
    meter_serial        VARCHAR(64) NOT NULL,
    interval_timestamp  TIMESTAMPTZ NOT NULL,
    rule_based_flag     BOOLEAN     NOT NULL DEFAULT FALSE,
    zscore_flag         BOOLEAN     NOT NULL DEFAULT FALSE,
    if_flag             BOOLEAN     NOT NULL DEFAULT FALSE,
    if_score            FLOAT,                          -- IF decision_function score
    zscore_value        FLOAT,                          -- z_score at detection time
    rule_violations     JSONB,       -- e.g. ["negative_energy", "voltage_too_low"]
    feature_snapshot    JSONB,       -- full 19-feature vector at detection time
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (meter_serial, interval_timestamp)
        REFERENCES meter_telemetry (meter_serial, interval_timestamp)
);
```

**`rule_violations` JSONB:** Stores the list of rule IDs that fired, e.g. `["negative_energy", "voltage_too_low"]`. Querying this column lets you answer "how many voltage anomalies occurred in the last 7 days" efficiently.

**`feature_snapshot` JSONB:** The complete 19-feature vector as it was at detection time. This is critical for debugging and for the future Decision Engine — it allows you to reconstruct exactly what the model saw when it made a decision, even months later.

**`if_score`:** The raw Isolation Forest `decision_function` score. Negative values mean anomalous; more negative = more anomalous. This enables ranking anomalies by severity.

**Foreign key:** References `meter_telemetry (meter_serial, interval_timestamp)` with `ON DELETE CASCADE`. If a telemetry record is cleaned up, its associated anomaly log entries are removed.

### DB Client
**File:** `db/client.py`

Uses `psycopg2.pool.SimpleConnectionPool` (min=1, max=10 connections). The context manager pattern ensures connections are always returned to the pool and transactions are rolled back on errors:

```python
with get_connection() as conn:
    with conn.cursor() as cur:
        cur.execute(...)
```

**Key query — `get_last_n_readings()`:**
```sql
SELECT interval_timestamp, raw_data
FROM meter_telemetry
WHERE meter_serial = %s
  AND interval_timestamp < %s    -- exclude the current reading
ORDER BY interval_timestamp DESC
LIMIT %s;
```

Returns results reversed to oldest→newest order, as required by the rolling feature computation.

**`init_schema()`:** Executes `schema.sql` on startup. All DDL uses `IF NOT EXISTS` so it is safe to run on every service start.

---

## 9. API — `api/`

**Start the service:**
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive documentation: `http://localhost:8000/docs`

The API is DB-optional. If PostgreSQL is unreachable, detection still works. History comes back empty, and the pipeline falls back to single-reading rolling features. Persistence errors are logged but never returned to the caller.

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

`records` is an array — the HES can push multiple interval records in one call (common when a meter reconnects after a gap and sends a backlog).

**What happens internally per record:**
1. Fetch last 10 readings for this `meterSerial` from `meter_telemetry` (DB query)
2. Call `pipeline.run(api_record, history)` — full 6-stage pipeline
3. Persist: write to `raw_meter_readings`, `meter_telemetry`, and `anomaly_log` (if anomalous)
4. Build and return response

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
          "layer": "rule_based",
          "is_anomaly": false,
          "violations": [],
          "details": {}
        },
        "zscore": {
          "layer": "zscore",
          "is_anomaly": true,
          "z_score": 8.34,
          "spike_ratio": 5.2,
          "triggers": ["zscore_spike", "extreme_spike_ratio"],
          "details": {
            "z_score": 8.34,
            "zscore_threshold": 3.0,
            "direction": "spike"
          }
        },
        "isolation_forest": {
          "layer": "isolation_forest",
          "is_anomaly": true,
          "anomaly_score": -0.1831,
          "prediction": -1
        }
      },
      "features": {
        "energy_consumption": 8.1,
        "hour_of_day": 10,
        "rolling_mean": 1.55,
        "z_score": 8.34,
        ...
      },
      "error": null
    }
  ]
}
```

**Response fields:**

| Field | Description |
|---|---|
| `total` | Number of records processed |
| `anomalies` | Count of records where `is_anomaly=true` |
| `results[].is_anomaly` | `true` if any detection layer fired |
| `results[].layers.rule_based.violations` | List of rule IDs that fired |
| `results[].layers.zscore.triggers` | List of statistical triggers that fired |
| `results[].layers.isolation_forest.anomaly_score` | Raw IF score (lower = more anomalous) |
| `results[].features` | Full 19-feature vector used for detection |
| `results[].error` | Non-null if the record could not be processed |

---

### GET /health

**Liveness check for load balancers and monitoring.**

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "timestamp": "2025-11-12T10:00:00+00:00",
  "components": {
    "model_artifacts": "ok",
    "database": "ok"
  }
}
```

`status` is `"ok"` when model artifacts exist on disk. `"degraded"` if any artifact file is missing. The service responds to requests even when degraded, but detection quality is reduced.

---

### GET /model/info

**Returns the feature schema, thresholds, and artifact paths.**

```bash
curl http://localhost:8000/model/info
```

```json
{
  "feature_schema": {
    "all_features": ["energy_consumption", "hour_of_day", ...],
    "core_features": [...],
    "optional_features": [...]
  },
  "detection_config": {
    "zscore_threshold": 3.0,
    "voltage_min": 180.0,
    "voltage_max": 270.0,
    ...
  },
  "rolling_window": 10,
  "artifact_paths": {
    "isolation_forest": "/absolute/path/to/models/isolation_forest.joblib",
    ...
  }
}
```

Use this to verify what feature schema the running model was trained on, and to confirm thresholds are as expected.

---

### POST /model/reload

**Hot-reloads model artifacts from disk without restarting the service.**

```bash
curl -X POST http://localhost:8000/model/reload
```

```json
{
  "status": "reloaded",
  "timestamp": "2025-11-12T10:00:00+00:00",
  "artifacts": { ... }
}
```

Call this immediately after running `training/train.py`. The new model takes effect for all subsequent `/detect` requests. Returns `503` if any artifact file is missing.

---

## 10. Model Artifacts — `models/`

Four files are saved by `training/train.py` and loaded by `pipeline/if_detector.py`:

| File | Type | Purpose |
|---|---|---|
| `isolation_forest.joblib` | `sklearn.ensemble.IsolationForest` | Makes anomaly predictions |
| `scaler.joblib` | `sklearn.preprocessing.StandardScaler` | Scales features using training statistics |
| `impute_values.joblib` | `pandas.Series` | Per-feature medians for imputing missing optional features |
| `feature_schema.joblib` | `dict` | Feature lists and column order |

**These four files must always be in sync with each other.** They are all produced in the same training run. Never replace one without replacing all four.

The `models/` directory should be excluded from version control (add to `.gitignore`) since the files are large and are regenerated by `train.py`.

---

## 11. Feature Schema Reference

Complete reference for all 19 features in the model's input vector:

### Core Features (always present)

| Feature | Description | How computed |
|---|---|---|
| `energy_consumption` | Active import energy for this interval (Wh) | Directly from OBIS `1.0.1.29.0.255` |
| `hour_of_day` | Hour of the interval timestamp (0–23) | `datetime.hour` |
| `day_of_week` | Day of week (0=Monday … 6=Sunday) | `datetime.weekday()` |
| `is_weekend` | 1 if Saturday or Sunday, else 0 | `day_of_week >= 5` |
| `holiday` | 1 if Sunday (holiday proxy), else 0 | `weekday() == 6` |
| `delta` | Change from previous reading | `energy[t] − energy[t-1]` |
| `rolling_mean` | Mean of last 5 energy readings | `rolling(5).mean()` |
| `rolling_std` | Std dev of last 5 energy readings | `rolling(5).std()` |
| `z_score` | Standard deviations from rolling mean | `(energy − rolling_mean) / (rolling_std + ε)` |
| `spike_ratio` | Ratio to rolling mean | `energy / (rolling_mean + ε)` |
| `historical_avg_same_hour` | Mean energy at this hour across all history for this meter | `groupby(hour).mean()` |
| `historical_avg_same_day_type` | Mean energy on weekdays vs weekends for this meter | `groupby(is_weekend).mean()` |

### Optional Features (NaN-imputed when absent)

| Feature | Description | How computed |
|---|---|---|
| `voltage` | Line voltage (V) | Directly from OBIS `1.0.12.27.0.255` |
| `current` | Line current (A) | Directly from OBIS `1.0.11.27.0.255` |
| `power_factor` | Power factor (0–1) | Directly from OBIS `1.0.13.27.0.255` |
| `apparent_import_energy` | Apparent import energy (VAh) | Directly from OBIS `1.0.9.29.0.255` |
| `current_delta` | Change in current from previous reading | `current[t] − current[t-1]` |
| `voltage_deviation` | Deviation from nominal 230V | `voltage − 230.0` |
| `power_factor_deviation` | Deviation from ideal power factor | `1.0 − power_factor` |

---

## 12. OBIS Code Registry

All 13 registered OBIS codes:

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

To add a new OBIS code, add one entry to `OBIS_REGISTRY` in `config/settings.py`. No other file needs to change.

---

## 13. Detection Thresholds Reference

| Threshold | Value | Layer | What it controls |
|---|---|---|---|
| `zscore_threshold` | 3.0 | Z-score | Flags if \|z_score\| > 3.0 |
| `spike_ratio_threshold` | 4.0 | Z-score | Flags if energy > 4× rolling mean |
| `drop_ratio_threshold` | 0.1 | Z-score | Flags if energy < 10% of rolling mean |
| `voltage_min` | 180 V | Rule | Flags if voltage < 180V |
| `voltage_max` | 270 V | Rule | Flags if voltage > 270V |
| `power_factor_min` | 0.0 | Rule | Flags if PF < 0 |
| `power_factor_max` | 1.0 | Rule | Flags if PF > 1 |
| `frequency_min` | 49 Hz | Rule | Flags if frequency < 49Hz |
| `frequency_max` | 51 Hz | Rule | Flags if frequency > 51Hz |
| `if_contamination` | 0.05 | Training | Expected anomaly rate in training data |
| `rolling_window_size` | 10 | Inference | Past readings fetched from DB for rolling features |

All tunable thresholds are in `config/settings.py`. `spike_ratio_threshold`, `drop_ratio_threshold`, and frequency bounds are hardcoded in their respective detector files currently.

---

## 14. Setup and Running

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

### 4. Train the model

```bash
python training/train.py
# → models/isolation_forest.joblib
# → models/scaler.joblib
# → models/impute_values.joblib
# → models/feature_schema.joblib
```

### 5. Start the API

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

The API will: load model artifacts, initialise the DB schema (creates tables if they don't exist), and start serving requests.

---

## 15. Testing Guide

### Verify setup

```bash
curl http://localhost:8000/health
```

### Test normal reading

```bash
curl -X POST http://localhost:8000/detect \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "id": 1, "meterSerial": "E0000001",
      "timestamp": "2025-11-12T10:00:00+00:00",
      "obisCode": "1.0.99.1.0.255", "entryId": 1,
      "rawValue": "1,0.0.1.0.0.255,2,2025-11-12 10:00:00,|2,1.0.12.27.0.255,2,230.5,V|3,1.0.1.29.0.255,2,1.6,Wh|4,1.0.11.27.0.255,2,1.4,A|5,1.0.13.27.0.255,2,0.92,"
    }]
  }'
```
Expected: `"is_anomaly": false`

### Test each anomaly type

| Scenario | rawValue segment to modify | Expected violation |
|---|---|---|
| Negative energy | `1.0.1.29.0.255` value = `-5.2` | `negative_energy` |
| Low voltage | `1.0.12.27.0.255` value = `150.0` | `voltage_too_low` |
| High voltage | `1.0.12.27.0.255` value = `275.0` | `voltage_too_high` |
| Bad power factor | `1.0.13.27.0.255` value = `1.5` | `power_factor_out_of_range` |
| Energy spike | `1.0.1.29.0.255` value = `45.0` | `zscore_spike` or `extreme_spike_ratio` |
| Unknown OBIS | Add `\|8,9.9.9.9.9.255,2,100.0,X` to rawValue | Warning logged, reading still processed |

### Verify DB records

```sql
psql -U meter_user -d meter_anomaly

SELECT id, meter_serial, received_at FROM raw_meter_readings ORDER BY id DESC LIMIT 5;
SELECT meter_serial, interval_timestamp, raw_data FROM meter_telemetry ORDER BY interval_timestamp DESC LIMIT 5;
SELECT meter_serial, interval_timestamp, rule_based_flag, zscore_flag, if_flag, if_score FROM anomaly_log ORDER BY detected_at DESC LIMIT 10;
```

### Common issues

| Error | Cause | Fix |
|---|---|---|
| `FileNotFoundError: isolation_forest.joblib` | Models not trained | Run `training/train.py` first |
| `connection refused` | PostgreSQL not running | Start PostgreSQL; API still works for detection without DB |
| `energy_consumption OBIS code not found` | rawValue missing `1.0.1.29.0.255` | Energy is the only required OBIS code |
| Import errors | Wrong working directory | Run all commands from inside `meter_anomaly/` |

---

## 16. Design Decisions

**Single source of truth in `settings.py`**
Every OBIS mapping, threshold, feature name, and file path lives in one file. This means adding a new OBIS code, adjusting a threshold, or changing a model path requires editing exactly one file.

**OBIS codes as keys in `raw_data`**
Storing raw data keyed by OBIS codes (rather than by canonical names) means the stored data is independent of the canonical mapping. If the canonical name for a feature changes, historical data does not need to be migrated.

**Derived features not stored in DB**
`delta`, `z_score`, `rolling_mean` etc. are computed from raw values at inference time. Storing them would create a dependency between stored values and future rolling computations — a reading's `rolling_mean` depends on its neighbors, so if any neighbor is updated or a gap is filled, stored derived values would become stale.

**One global Isolation Forest with imputation**
Rather than training a separate model per meter capability profile (e.g. one for energy-only meters, one for full-feature meters), a single model is trained with missing optional features filled by the column median. This is simpler to maintain (one model to retrain, one set of artifacts) and works well because Isolation Forest is robust to imputed values — the median is a neutral, inlier-like value that does not bias the anomaly score.

**DB is optional at runtime**
If the DB is unavailable, the API still detects anomalies using only the current reading's features. Rolling features degrade gracefully (window of 1 instead of 10) rather than crashing. This makes the service more resilient to DB maintenance windows.

**Conservative anomaly verdict**
`is_anomaly=True` if any layer fires. This maximises recall (catches more anomalies) at the cost of higher false positive rate. The upcoming Decision Engine will add confidence scoring to let operators filter by severity.

---

## 17. What Is Not Yet Built

**Decision Engine (Step 5)**
The current pipeline outputs *that* an anomaly was detected. The Decision Engine will output *what* the anomaly probably is — assigning an anomaly category (meter tampering, power theft, sensor fault, communication failure, voltage spike, sudden consumption spike), a severity score, a confidence level, and a probable root cause, by analysing the combination of features and which layers fired.

**Kafka Integration**
The architecture supports a Kafka producer/consumer layer between the HES and the detection service. Currently the API accepts direct HTTP pushes from the HES. The pipeline module is already decoupled from the transport layer — adding a Kafka consumer that calls `pipeline.run()` requires only a new consumer script.

**Dashboard / HES Plugin**
No frontend is implemented. The `anomaly_log` and `meter_telemetry` tables are designed to back a dashboard showing live anomalies, meter-wise trends, voltage/current graphs, anomaly heatmaps, and historical analysis.

**Model retraining pipeline**
There is no automated retraining schedule. Retraining is currently a manual process: run `dataset/generate_dataset.py`, run `training/train.py`, call `POST /model/reload`.

**Authentication**
The API has no authentication or rate limiting. All endpoints are publicly accessible.
