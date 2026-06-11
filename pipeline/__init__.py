"""
pipeline/__init__.py
---------------------
Orchestrates the full detection pipeline end to end.
Energy consumption is NOT required — pipeline continues with
whatever canonical features are available.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from pipeline.obis_parser      import parse_api_record, OBISParseError
from pipeline.canonical_mapper import map_to_canonical
from pipeline.feature_engineer import compute_features
from pipeline import rule_based
from pipeline import zscore_detector
from pipeline import if_detector

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    meter_serial:        str
    interval_timestamp:  str
    is_anomaly:          bool
    rule_based:          dict          = field(default_factory=dict)
    zscore:              dict          = field(default_factory=dict)
    isolation_forest:    dict          = field(default_factory=dict)
    features:            dict          = field(default_factory=dict)
    error:               Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "meter_serial":       self.meter_serial,
            "interval_timestamp": self.interval_timestamp,
            "is_anomaly":         self.is_anomaly,
            "layers": {
                "rule_based":       self.rule_based,
                "zscore":           self.zscore,
                "isolation_forest": self.isolation_forest,
            },
            "features": self.features,
            "error":    self.error,
        }


def run(api_record: dict, history: list[dict]) -> PipelineResult:
    """
    Runs the complete detection pipeline for one API record.
    Energy consumption is not required; all features degrade
    gracefully when parameters are absent.
    """
    meter_serial = api_record.get("meterSerial", "UNKNOWN")

    # ── Stage 1: Parse rawValue ────────────────────────────
    try:
        parsed = parse_api_record(api_record)
    except (OBISParseError, KeyError) as e:
        logger.error(f"[{meter_serial}] OBIS parse failed: {e}")
        return PipelineResult(
            meter_serial=meter_serial,
            interval_timestamp="UNKNOWN",
            is_anomaly=False,
            error=f"obis_parse_error: {str(e)}",
        )

    interval_ts = parsed["interval_timestamp"]

    # ── Stage 2: Canonical mapping ────────────────────────
    canonical = map_to_canonical(parsed["readings"])

    if not canonical:
        msg = "No recognisable OBIS codes in payload."
        logger.error(f"[{meter_serial}] {msg}")
        return PipelineResult(
            meter_serial=meter_serial,
            interval_timestamp=interval_ts,
            is_anomaly=False,
            error=f"empty_canonical: {msg}",
        )

    if "energy_consumption" not in canonical:
        logger.info(
            f"[{meter_serial}] energy_consumption absent — continuing with: "
            f"{list(canonical.keys())}"
        )

    # ── Stage 3: Feature engineering ──────────────────────
    try:
        features = compute_features(
            canonical=canonical,
            interval_ts=interval_ts,
            history=history,
        )
    except Exception as e:
        logger.error(f"[{meter_serial}] Feature engineering failed: {e}")
        return PipelineResult(
            meter_serial=meter_serial,
            interval_timestamp=interval_ts,
            is_anomaly=False,
            error=f"feature_engineering_error: {str(e)}",
        )

    # ── Stage 4: Rule-based detection ─────────────────────
    rule_result   = rule_based.check(features)

    # ── Stage 5: Z-score detection ────────────────────────
    zscore_result = zscore_detector.check(features)

    # ── Stage 6: Isolation Forest (with group routing) ────
    try:
        if_result = if_detector.check(features, canonical=canonical)
    except FileNotFoundError as e:
        logger.error(f"[{meter_serial}] IF model not loaded: {e}")
        if_result = None

    # ── Overall verdict ───────────────────────────────────
    is_anomaly = (
        rule_result.is_anomaly
        or zscore_result.is_anomaly
        or (if_result is not None and if_result.is_anomaly)
    )

    if is_anomaly:
        layers_fired = []
        if rule_result.is_anomaly:                      layers_fired.append("rule_based")
        if zscore_result.is_anomaly:                    layers_fired.append("zscore")
        if if_result and if_result.is_anomaly:          layers_fired.append("isolation_forest")
        logger.info(
            f"[{meter_serial}] ANOMALY at {interval_ts} | layers: {layers_fired}"
        )

    return PipelineResult(
        meter_serial=meter_serial,
        interval_timestamp=interval_ts,
        is_anomaly=is_anomaly,
        rule_based=rule_result.to_dict(),
        zscore=zscore_result.to_dict(),
        isolation_forest=(
            if_result.to_dict() if if_result
            else {"error": "model_not_loaded"}
        ),
        features=features,
    )