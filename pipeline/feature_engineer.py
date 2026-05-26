"""
pipeline/feature_engineer.py
-----------------------------
Computes derived features from a canonical dict + DB history.

Energy consumption is NOT required. Every feature degrades
gracefully if a parameter is absent:
  - Energy absent  → delta, rolling_mean, z_score, spike_ratio,
                      historical_avg_* all become None
  - Voltage absent → voltage_deviation becomes None
  - Current absent → current_delta becomes None
  - PF absent      → power_factor_deviation becomes None

Time features (hour_of_day, day_of_week, is_weekend, holiday)
are always computed from the interval timestamp.

The primary series for rolling stats uses whatever is available,
in priority order: energy_consumption → current → voltage.
"""

import logging
import numpy as np
from datetime import datetime
from typing import Optional
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from config.settings import ALL_FEATURES

logger = logging.getLogger(__name__)

NOMINAL_VOLTAGE  = 230.0
ROLLING_WINDOW   = 5

# Priority order for the "primary series" used in rolling stats.
# The first key present in the canonical dict wins.
PRIMARY_SERIES_PRIORITY = [
    "energy_consumption",
    "current",
    "voltage",
]


def _is_holiday(dt: datetime) -> int:
    return 1 if dt.weekday() == 6 else 0


def _optional_float(d: dict, key: str) -> Optional[float]:
    val = d.get(key)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _round_opt(val: Optional[float], ndigits: int = 4) -> Optional[float]:
    return round(val, ndigits) if val is not None else None


def _parse_hour(ts_str) -> Optional[int]:
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(str(ts_str)).hour
    except Exception:
        return None


def _parse_is_weekend(ts_str) -> Optional[int]:
    if not ts_str:
        return None
    try:
        return 1 if datetime.fromisoformat(str(ts_str)).weekday() >= 5 else 0
    except Exception:
        return None


def _last_canonical_value(history: list[dict], key: str) -> Optional[float]:
    for h in reversed(history):
        val = h.get("raw_data", {}).get(key)
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                continue
    return None


def _build_series(history: list[dict], key: str, current_val: float) -> list[float]:
    """
    Builds a time series for `key` from history + current value.
    Missing history values are forward-filled with the last known.
    """
    series = []
    last_known = None
    for h in history:
        val = h.get("raw_data", {}).get(key)
        if val is not None:
            try:
                v = float(val)
                series.append(v)
                last_known = v
            except (TypeError, ValueError):
                if last_known is not None:
                    series.append(last_known)
        else:
            if last_known is not None:
                series.append(last_known)
    series.append(current_val)
    return series


def _rolling_features(series: list[float], current_val: float):
    """
    Computes rolling_mean, rolling_std, z_score, spike_ratio, delta
    from a series (oldest → newest, current value is last).
    Returns a tuple of (delta, rolling_mean, rolling_std, z_score, spike_ratio).
    """
    n = len(series)
    delta = (current_val - series[-2]) if n >= 2 else 0.0

    window       = series[-ROLLING_WINDOW:]
    rolling_mean = float(np.mean(window))
    rolling_std  = float(np.std(window)) if len(window) > 1 else 0.0
    z_score      = (current_val - rolling_mean) / (rolling_std + 1e-5)
    spike_ratio  = current_val / (rolling_mean + 1e-5)

    return delta, rolling_mean, rolling_std, z_score, spike_ratio


def compute_features(
    canonical: dict,
    interval_ts: str,
    history: list[dict],
) -> dict:
    """
    Computes the full feature vector for one reading.

    Parameters
    ----------
    canonical    : canonical feature dict for the current reading.
                   energy_consumption is NOT required.
    interval_ts  : ISO timestamp string of the current reading.
    history      : list of past readings (oldest → newest),
                   each with {"interval_timestamp": ..., "raw_data": dict}.

    Returns
    -------
    dict with ALL_FEATURES keys. Features that cannot be computed
    due to missing parameters are set to None.
    """

    # ── Parse timestamp ───────────────────────────────────
    try:
        dt = datetime.fromisoformat(str(interval_ts))
    except Exception as e:
        logger.warning(f"Cannot parse interval_timestamp '{interval_ts}': {e}. Using utcnow().")
        dt = datetime.utcnow()

    # ── Time features (always available) ─────────────────
    hour_of_day = dt.hour
    day_of_week = dt.weekday()
    is_weekend  = 1 if day_of_week >= 5 else 0
    holiday     = _is_holiday(dt)

    # ── Raw electrical values ─────────────────────────────
    energy  = _optional_float(canonical, "energy_consumption")
    voltage = _optional_float(canonical, "voltage")
    current = _optional_float(canonical, "current")
    pf      = _optional_float(canonical, "power_factor")
    app_e   = _optional_float(canonical, "apparent_import_energy")

    # ── Determine primary series for rolling stats ────────
    # Use the first available parameter in priority order.
    primary_key = None
    primary_val = None
    for key in PRIMARY_SERIES_PRIORITY:
        val = _optional_float(canonical, key)
        if val is not None:
            primary_key = key
            primary_val = val
            break

    # ── Rolling features ──────────────────────────────────
    delta = rolling_mean = rolling_std = z_score = spike_ratio = None

    if primary_val is not None:
        series = _build_series(history, primary_key, primary_val)
        delta, rolling_mean, rolling_std, z_score, spike_ratio = _rolling_features(
            series, primary_val
        )
        if primary_key != "energy_consumption":
            # If rolling stats are based on a non-energy primary,
            # still log so it's traceable
            logger.debug(
                f"Rolling stats computed from '{primary_key}' "
                f"(energy_consumption unavailable)."
            )

    # ── Energy-specific rolling features ─────────────────
    # delta/rolling_mean/z_score/spike_ratio computed above use
    # primary series. When energy IS the primary, they are energy-based.
    # When energy is absent, they reflect the available primary (current/voltage).

    # ── Historical averages ───────────────────────────────
    # Computed from energy when available, else from primary series.
    hist_key = "energy_consumption" if energy is not None else primary_key

    historical_avg_same_hour     = None
    historical_avg_same_day_type = None

    if hist_key is not None:
        same_hour_vals = [
            float(h["raw_data"][hist_key])
            for h in history
            if (
                h.get("raw_data", {}).get(hist_key) is not None
                and _parse_hour(h.get("interval_timestamp")) == hour_of_day
            )
        ]
        same_day_type_vals = [
            float(h["raw_data"][hist_key])
            for h in history
            if (
                h.get("raw_data", {}).get(hist_key) is not None
                and _parse_is_weekend(h.get("interval_timestamp")) == is_weekend
            )
        ]
        ref_val = _optional_float(canonical, hist_key) or 0.0
        historical_avg_same_hour = (
            float(np.mean(same_hour_vals)) if same_hour_vals else ref_val
        )
        historical_avg_same_day_type = (
            float(np.mean(same_day_type_vals)) if same_day_type_vals else ref_val
        )

    # ── Optional derived features ─────────────────────────
    current_delta = None
    if current is not None:
        prev_current = _last_canonical_value(history, "current")
        if prev_current is not None:
            current_delta = current - prev_current

    voltage_deviation      = (voltage - NOMINAL_VOLTAGE) if voltage is not None else None
    power_factor_deviation = (1.0 - pf)                  if pf      is not None else None

    # ── Assemble ──────────────────────────────────────────
    features = {
        "energy_consumption":           _round_opt(energy),
        "hour_of_day":                  hour_of_day,
        "day_of_week":                  day_of_week,
        "is_weekend":                   is_weekend,
        "holiday":                      holiday,
        "delta":                        _round_opt(delta),
        "rolling_mean":                 _round_opt(rolling_mean),
        "rolling_std":                  _round_opt(rolling_std),
        "z_score":                      _round_opt(z_score),
        "spike_ratio":                  _round_opt(spike_ratio),
        "historical_avg_same_hour":     _round_opt(historical_avg_same_hour),
        "historical_avg_same_day_type": _round_opt(historical_avg_same_day_type),
        "voltage":                      _round_opt(voltage),
        "current":                      _round_opt(current),
        "power_factor":                 _round_opt(pf),
        "apparent_import_energy":       _round_opt(app_e),
        "current_delta":                _round_opt(current_delta),
        "voltage_deviation":            _round_opt(voltage_deviation),
        "power_factor_deviation":       _round_opt(power_factor_deviation),
    }

    # Ensure all ALL_FEATURES keys are present (None for missing)
    for f in ALL_FEATURES:
        if f not in features:
            features[f] = None

    return features


def get_present_canonical_features(canonical: dict) -> frozenset:
    """
    Returns the frozenset of canonical feature names that are
    actually present (non-None) in the canonical dict.
    Used by if_detector to route to the correct group model.
    """
    return frozenset(k for k, v in canonical.items() if v is not None)