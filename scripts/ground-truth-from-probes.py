#!/usr/bin/env python3
"""
ground-truth-from-probes.py

Extracts real ground-truth delays for each UXsim scenario from two sources:
  1. STPT arrival model (signal-level speed ratios + delays by time slot)
  2. TomTom corridor profiles (per-segment speed ratios and delays)

These replace the circular TACTICS benchmark in scenarios.json.

Key insight: scenarios.json "groundTruth" field contains delay *reductions*
(not absolute delays), so we compute real absolute delays from probes.

Output: data/uxsim/ground-truth-real.json
"""

import csv
import json
import math
import os
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.resolve()

# ─── Load data ─────────────────────────────────────────────────────────────────

def load_scenarios():
    with open(REPO_ROOT / "data" / "scenarios.json") as f:
        return json.load(f)

def load_signals():
    with open(REPO_ROOT / "data" / "traffic-lights" / "signals.json") as f:
        return json.load(f)

def load_arrival_model():
    with open(REPO_ROOT / "data" / "derived" / "arrival-model.json") as f:
        return json.load(f)

def load_tomtom_profiles():
    with open(REPO_ROOT / "data" / "derived" / "tomtom-corridor-profiles.json") as f:
        return json.load(f)

def load_tomtom_flow_csvs():
    """Load all TomTom flow CSVs and return list of dicts."""
    csv_dir = REPO_ROOT / "data" / "traffic-flow" / "csv"
    flow_files = sorted(csv_dir.glob("tomtom-flow-*.csv"))
    rows = []
    for path in flow_files:
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
    return rows

# ─── Haversine ────────────────────────────────────────────────────────────────────

def haversine_m(a, b):
    R = 6_371_000
    dlat = math.radians(b[1] - a[1])
    dlon = math.radians(b[0] - a[0])
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    v = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(v), math.sqrt(1 - v))

# ─── STPT arrival-model ground truth ─────────────────────────────────────────

def compute_arrival_model_ground_truth(scenarios, signals_data, arrival_model):
    """
    For each scenario, average delays across all signals in the scenario,
    by time slot, weighted by sample count.
    """
    id_to_sig = {s["id"]: s for s in signals_data.get("programs", [])}

    # Build scenario -> signal mapping
    scenario_signals = {}
    for scenario in scenarios:
        sid = scenario["id"]
        signal_ids = scenario.get("signalIds", [])
        sigs = []
        for s in signal_ids:
            prog = id_to_sig.get(s)
            if prog:
                sigs.append(prog)
        scenario_signals[sid] = sigs

    time_slots = ["morning-rush", "midday", "afternoon-rush", "evening"]

    results = {}

    for scenario in scenarios:
        sid = scenario["id"]
        corridor_name = scenario["corridor"]
        sigs = scenario_signals.get(sid, [])

        if not sigs:
            print(f"  [WARN] {sid}: no signals found")
            continue

        # Collect delays per slot across all signals in this scenario
        slot_data = defaultdict(list)  # slot -> [(delay, samples), ...]
        for approach in arrival_model.get("approaches", []):
            sig_id = approach.get("signalId")
            if sig_id not in [s["id"] for s in sigs]:
                continue
            slot = approach.get("timeSlot")
            if slot not in time_slots:
                continue
            avg_delay = approach.get("avgDelaySeconds", 0)
            speed_ratio = approach.get("speedRatio", 0)
            samples = approach.get("sampleCount", 0)
            if samples >= 3:  # minimum confidence threshold
                slot_data[slot].append((avg_delay, speed_ratio, samples))

        # Weighted average delay + speed ratio per slot
        slot_results = {}
        for slot in time_slots:
            items = slot_data.get(slot, [])
            if not items:
                continue
            total_delay = sum(d * s for d, _, s in items)
            total_sr = sum(sr * s for _, sr, s in items)
            total_samples = sum(s for _, _, s in items)
            if total_samples > 0:
                slot_results[slot] = {
                    "avg_delay_s": round(total_delay / total_samples, 1),
                    "avg_speed_ratio": round(total_sr / total_samples, 3),
                    "total_samples": total_samples,
                    "n_signals": len(items),
                }

        if slot_results:
            # Overall (across slots) weighted average
            overall_delay = sum(v["avg_delay_s"] * v["total_samples"]
                               for v in slot_results.values()) / sum(
                                   v["total_samples"] for v in slot_results.values()
                               ) if slot_results else 0
            overall_sr = sum(v["avg_speed_ratio"] * v["total_samples"]
                             for v in slot_results.values()) / sum(
                                 v["total_samples"] for v in slot_results.values()
                             ) if slot_results else 0
            results[sid] = {
                "corridor": corridor_name,
                "n_signals": len(sigs),
                "slot_results": slot_results,
                "overall_avg_delay_s": round(overall_delay, 1),
                "overall_avg_speed_ratio": round(overall_sr, 3),
            }

    return results

# ─── TomTom ground truth ──────────────────────────────────────────────────────

def compute_tomtom_ground_truth(scenarios, signals_data, tomtom_profiles, tomtom_rows):
    """
    For each scenario, compute average speed ratio and delay from TomTom
    segments within the corridor bounding box.
    """
    id_to_sig = {s["id"]: s for s in signals_data.get("programs", [])}

    results = {}

    for scenario in scenarios:
        sid = scenario["id"]
        signal_ids = scenario.get("signalIds", [])
        corridor_name = scenario["corridor"]

        scenario_sigs = []
        for sid2 in signal_ids:
            prog = id_to_sig.get(sid2)
            if prog:
                pos = prog["position"]
                scenario_sigs.append((sid2, pos["lng"], pos["lat"]))

        if not scenario_sigs:
            continue

        # Bounding box with 500m padding
        lngs = [s[1] for s in scenario_sigs]
        lats = [s[2] for s in scenario_sigs]
        pad = 0.005
        min_lng, max_lng = min(lngs) - pad, max(lngs) + pad
        min_lat, max_lat = min(lats) - pad, max(lats) + pad

        # Collect TomTom rows near this corridor
        corridor_rows = []
        for row in tomtom_rows:
            try:
                lat = float(row.get("lat", 0))
                lng = float(row.get("lng", 0))
                if min_lng < lng < max_lng and min_lat < lat < max_lat:
                    corridor_rows.append(row)
            except (ValueError, TypeError):
                continue

        if not corridor_rows:
            print(f"  [WARN] {sid}: no TomTom segments in bounding box")
            continue

        # Aggregate per pointId to avoid double-counting
        by_point = defaultdict(list)
        for row in corridor_rows:
            pid = row.get("pointId", "")
            try:
                sr = float(row.get("speedRatio", 0))
                delay = float(row.get("delaySeconds", 0))
                if 0 < sr < 2:
                    by_point[pid].append((sr, delay))
            except (ValueError, TypeError):
                continue

        all_srs = []
        all_delays = []
        for pid, items in by_point.items():
            median_sr = sorted([x[0] for x in items])[len(items) // 2]
            median_delay = sorted([x[1] for x in items])[len(items) // 2]
            all_srs.append(median_sr)
            all_delays.append(median_delay)

        avg_sr = sum(all_srs) / len(all_srs) if all_srs else 0
        avg_delay = sum(all_delays) / len(all_delays) if all_delays else 0
        std_sr = (sum((sr - avg_sr) ** 2 for sr in all_srs) / len(all_srs)) ** 0.5 if len(all_srs) > 1 else 0

        results[sid] = {
            "corridor": corridor_name,
            "n_segments": len(by_point),
            "avg_speed_ratio": round(avg_sr, 3),
            "std_speed_ratio": round(std_sr, 3),
            "avg_delay_s": round(avg_delay, 1),
            "n_measurements": len(all_srs),
        }

    return results

# ─── Consensus ground truth ───────────────────────────────────────────────────

def compute_consensus(arr_gt, tomtom_gt, scenarios):
    """
    Merge arrival model + TomTom into a single ground truth estimate.
    Priority: arrival model (probe-derived), fallback to TomTom.
    """
    merged = {}

    for scenario in scenarios:
        sid = scenario["id"]
        arr = arr_gt.get(sid, {})
        tt = tomtom_gt.get(sid, {})

        arr_delay = arr.get("overall_avg_delay_s")
        arr_sr = arr.get("overall_avg_speed_ratio")
        tt_delay = tt.get("avg_delay_s")
        tt_sr = tt.get("avg_speed_ratio")

        # Consensus: use arrival model, fall back to TomTom
        if arr_delay is not None and arr_delay > 0:
            consensus_delay = arr_delay
            confidence = "high" if arr.get("slot_results", {}).get("morning-rush", {}).get("n_signals", 0) >= 3 else "medium"
            source = "arrival_model"
        elif tt_delay is not None and tt_delay > 0:
            consensus_delay = tt_delay
            confidence = "low"
            source = "tomtom"
        else:
            consensus_delay = None
            confidence = "insufficient"
            source = None

        merged[sid] = {
            "corridor": arr.get("corridor") or tt.get("corridor"),
            "consensus_delay_s": consensus_delay,
            "confidence": confidence,
            "source": source,
            "arrival_model": {
                "avg_delay_s": arr_delay,
                "avg_speed_ratio": arr_sr,
                "n_signals": arr.get("n_signals"),
                "slot_results": arr.get("slot_results", {}),
            } if arr else None,
            "tomtom": {
                "avg_delay_s": tt_delay,
                "avg_speed_ratio": tt_sr,
                "n_segments": tt.get("n_segments"),
            } if tt else None,
            # Old scenarios.json groundTruth (for reference — these are likely delay reductions)
            "old_benchmark_groundTruth": scenario.get("groundTruth"),
        }

    return merged

# ─── Main ────────────────────────────────────────────────────────────────────────

def main():
    print("\n=== Ground Truth from Probes ===\n")

    scenarios = load_scenarios()
    signals = load_signals()
    arr_model = load_arrival_model()
    tomtom_prof = load_tomtom_profiles()
    tomtom_rows = load_tomtom_flow_csvs()

    print(f"  scenarios: {len(scenarios)}")
    print(f"  signals: {len(signals.get('programs', []))}")
    print(f"  arrival model approaches: {len(arr_model.get('approaches', []))}")
    print(f"  TomTom profiles: {len(tomtom_prof.get('segments', []))}")
    print(f"  TomTom flow rows: {len(tomtom_rows)}")

    print("\n[1/3] Computing STPT arrival model ground truth...")
    arr_gt = compute_arrival_model_ground_truth(scenarios, signals, arr_model)
    for sid, data in arr_gt.items():
        slots = list(data["slot_results"].keys())
        print(f"  {sid} ({data['corridor']}): "
              f"overall={data['overall_avg_delay_s']}s, sr={data['overall_avg_speed_ratio']}, "
              f"n_signals={data['n_signals']}, slots={slots}")

    print("\n[2/3] Computing TomTom ground truth...")
    tomtom_gt = compute_tomtom_ground_truth(scenarios, signals, tomtom_prof, tomtom_rows)
    for sid, data in tomtom_gt.items():
        print(f"  {sid} ({data['corridor']}): "
              f"{data['n_segments']} segments, sr={data['avg_speed_ratio']}±{data.get('std_speed_ratio', 0)}, "
              f"delay={data['avg_delay_s']}s")

    print("\n[3/3] Merging ground truth sources...")
    consensus = compute_consensus(arr_gt, tomtom_gt, scenarios)
    for sid, data in consensus.items():
        cd = data['consensus_delay_s']
        old = data['old_benchmark_groundTruth']
        conf = data['confidence']
        src = data['source']
        print(f"  {sid}: consensus={cd}s (confidence={conf}, source={src}) "
              f"[was benchmark groundTruth={old}s]")

    # Save
    output = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "sources": [
            "STPT arrival-model.json (probe-derived speed ratios and delays per signal per slot)",
            "TomTom tomtom-corridor-profiles.json + flow CSVs (May 14 floating car data)",
        ],
        "note": "scenarios.json groundTruth values are likely delay reductions from TACTICS adaptive control, not absolute delays",
        "scenarios": consensus,
    }
    out_path = REPO_ROOT / "data" / "uxsim" / "ground-truth-real.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved to {out_path}")

if __name__ == "__main__":
    main()