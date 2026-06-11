import os
from dotenv import load_dotenv
# =========================================================
# DATABASE
# =========================================================
load_dotenv()  # Load from .env file if present

DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME",     "meter_anomaly"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD"),
}

DB_DSN = (
    f"postgresql://{DB_CONFIG['user']}:{DB_CONFIG['password']}"
    f"@{DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['dbname']}"
)

# =========================================================
# MODEL ARTIFACTS
# =========================================================

MODEL_DIR = os.getenv(
    "MODEL_DIR",
    os.path.join(os.path.dirname(__file__), "..", "models")
)

# Global fallback model (trained on all data with NaN imputation).
# Used when incoming payload does not match any capability group.
MODEL_PATHS = {
    "isolation_forest": os.path.join(MODEL_DIR, "isolation_forest.joblib"),
    "scaler":           os.path.join(MODEL_DIR, "scaler.joblib"),
    "impute_values":    os.path.join(MODEL_DIR, "impute_values.joblib"),
    "feature_schema":   os.path.join(MODEL_DIR, "feature_schema.joblib"),
}

def group_model_paths(group_name: str) -> dict:
    """
    Returns artifact paths for a specific capability group model.
    Artifacts are stored under models/<group_name>/.
    """
    group_dir = os.path.join(MODEL_DIR, group_name)
    return {
        "isolation_forest": os.path.join(group_dir, "isolation_forest.joblib"),
        "scaler":           os.path.join(group_dir, "scaler.joblib"),
        "feature_schema":   os.path.join(group_dir, "feature_schema.joblib"),
    }

# =========================================================
# DATASET GENERATION
# =========================================================

DATASET_CONFIG = {
    "num_meters":    10,
    "days":          15,
    "freq_minutes":  30,
    "start_time":    "2026-01-01",
    "random_seed":   42,
}

# =========================================================
# OBIS CODE REGISTRY
# Maps every known OBIS code to canonical feature name.
# To add a new OBIS code: add one entry here.
# Nothing else in the codebase needs to change.
# =========================================================

OBIS_REGISTRY = {
    # ── Clock / Timestamp ────────────────────────────────
    "0.0.1.0.0.255": {
        "canonical_name": None,
        "description":    "Interval timestamp (clock object)",
        "unit":           "",
        "is_timestamp":   True,
    },

    # ── Energy ───────────────────────────────────────────
    "1.0.1.29.0.255": {
        "canonical_name": "energy_consumption",
        "description":    "Active import energy – interval (Wh)",
        "unit":           "Wh",
        "is_timestamp":   False,
    },
    "1.0.2.29.0.255": {
        "canonical_name": "active_export_energy",
        "description":    "Active export energy – interval (Wh)",
        "unit":           "Wh",
        "is_timestamp":   False,
    },
    "1.0.9.29.0.255": {
        "canonical_name": "apparent_import_energy",
        "description":    "Apparent import energy – interval (VAh)",
        "unit":           "VAh",
        "is_timestamp":   False,
    },
    "1.0.10.29.0.255": {
        "canonical_name": "apparent_export_energy",
        "description":    "Apparent export energy – interval (VAh)",
        "unit":           "VAh",
        "is_timestamp":   False,
    },
    "1.0.3.29.0.255": {
        "canonical_name": "reactive_import_energy",
        "description":    "Reactive import energy – interval (VARh)",
        "unit":           "VARh",
        "is_timestamp":   False,
    },
    "1.0.4.29.0.255": {
        "canonical_name": "reactive_export_energy",
        "description":    "Reactive export energy – interval (VARh)",
        "unit":           "VARh",
        "is_timestamp":   False,
    },

    # ── Power ────────────────────────────────────────────
    "1.0.1.27.0.255": {
        "canonical_name": "active_import_power",
        "description":    "Active import power (W)",
        "unit":           "W",
        "is_timestamp":   False,
    },
    "1.0.2.27.0.255": {
        "canonical_name": "active_export_power",
        "description":    "Active export power (W)",
        "unit":           "W",
        "is_timestamp":   False,
    },

    # ── Voltage ──────────────────────────────────────────
    "1.0.12.27.0.255": {
        "canonical_name": "voltage",
        "description":    "Voltage (V)",
        "unit":           "V",
        "is_timestamp":   False,
    },

    # ── Current ──────────────────────────────────────────
    "1.0.11.27.0.255": {
        "canonical_name": "current",
        "description":    "Current (A)",
        "unit":           "A",
        "is_timestamp":   False,
    },

    # ── Power Factor ─────────────────────────────────────
    "1.0.13.27.0.255": {
        "canonical_name": "power_factor",
        "description":    "Power factor",
        "unit":           "",
        "is_timestamp":   False,
    },

    # ── Frequency ────────────────────────────────────────
    "1.0.14.27.0.255": {
        "canonical_name": "frequency",
        "description":    "Frequency (Hz)",
        "unit":           "Hz",
        "is_timestamp":   False,
    },
}

# =========================================================
# CAPABILITY GROUPS
#
# Each group defines the EXACT set of canonical feature names
# that a meter in that group exposes. The routing logic uses
# these to match incoming payloads to the right model.
#
# HOW TO CHANGE FOR REAL-WORLD DATA:
#   - Add a new group key with the exact canonical names your
#     new meter profile exposes.
#   - Re-run training/train.py to train a model for the new group.
#   - No other file needs to change.
#
# MATCHING RULES (applied in order):
#   1. Exact match  — incoming features == group features exactly
#   2. Subset match — incoming features ⊆ group features
#      (picks the group with the most overlap)
#   3. Fallback     — global model with NaN imputation
#
# Keys are stable group identifiers used as directory names
# under models/ (e.g. models/group_A/).
# =========================================================

CAPABILITY_GROUPS = {
    # Group A: energy + voltage + current + power factor
    "group_A": frozenset([
        "energy_consumption",
        "voltage",
        "current",
        "power_factor",
    ]),

    # Group B: energy + apparent energy + voltage
    "group_B": frozenset([
        "energy_consumption",
        "apparent_import_energy",
        "voltage",
    ]),

    # Group C: energy + current only
    "group_C": frozenset([
        "energy_consumption",
        "current",
    ]),

    # Group D: full feature set
    "group_D": frozenset([
        "energy_consumption",
        "active_export_energy",
        "apparent_import_energy",
        "voltage",
        "current",
        "power_factor",
        "frequency",
    ]),

    # Group E: energy only
    "group_E": frozenset([
        "energy_consumption",
    ]),

    # Group V: voltage + current only (no energy)
    # Example: a meter that only sends electrical quality params
    "group_V": frozenset([
        "voltage",
        "current",
    ]),
}

# =========================================================
# METER CAPABILITY PROFILES (used by dataset generator)
# Maps directly to CAPABILITY_GROUPS above.
# =========================================================

METER_CAPABILITY_PROFILES = [
    # Profile A
    ["1.0.1.29.0.255", "1.0.12.27.0.255", "1.0.11.27.0.255", "1.0.13.27.0.255"],
    # Profile B
    ["1.0.1.29.0.255", "1.0.9.29.0.255",  "1.0.12.27.0.255"],
    # Profile C
    ["1.0.1.29.0.255", "1.0.11.27.0.255"],
    # Profile D
    ["1.0.1.29.0.255", "1.0.2.29.0.255", "1.0.9.29.0.255",
     "1.0.12.27.0.255", "1.0.11.27.0.255", "1.0.13.27.0.255", "1.0.14.27.0.255"],
    # Profile E
    ["1.0.1.29.0.255"],
]

# =========================================================
# FEATURE SCHEMA
# Fixed vector for the global fallback model.
# Per-group models use only their group's features + derived.
# =========================================================

CORE_FEATURES = [
    "energy_consumption",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "holiday",
    "delta",
    "rolling_mean",
    "rolling_std",
    "z_score",
    "spike_ratio",
    "historical_avg_same_hour",
    "historical_avg_same_day_type",
]

OPTIONAL_FEATURES = [
    "voltage",
    "current",
    "power_factor",
    "apparent_import_energy",
    "current_delta",
    "voltage_deviation",
    "power_factor_deviation",
]

ALL_FEATURES = CORE_FEATURES + OPTIONAL_FEATURES

# =========================================================
# DERIVED FEATURE MAPPING
# Maps each raw canonical feature → derived features that
# can be computed from it. Used by feature engineer and
# training to know which derived features to include for
# a given capability group.
# =========================================================

DERIVED_FEATURE_MAP = {
    # From energy_consumption
    "energy_consumption": [
        "delta",
        "rolling_mean",
        "rolling_std",
        "z_score",
        "spike_ratio",
        "historical_avg_same_hour",
        "historical_avg_same_day_type",
    ],
    # From current
    "current": [
        "current_delta",
    ],
    # From voltage
    "voltage": [
        "voltage_deviation",
    ],
    # From power_factor
    "power_factor": [
        "power_factor_deviation",
    ],
    # Time features are always available (from timestamp)
    "_timestamp": [
        "hour_of_day",
        "day_of_week",
        "is_weekend",
        "holiday",
    ],
}

# =========================================================
# DETECTION THRESHOLDS
# =========================================================

DETECTION_CONFIG = {
    "zscore_threshold":        3.0,
    "voltage_min":             180.0,
    "voltage_max":             270.0,
    "power_factor_min":        0.0,
    "power_factor_max":        1.0,
    "zero_consumption_window": 3,
    "if_contamination":        0.05,
}

# =========================================================
# ROLLING WINDOW
# =========================================================

ROLLING_WINDOW_SIZE = 10