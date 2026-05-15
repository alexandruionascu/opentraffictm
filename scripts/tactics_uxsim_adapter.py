#!/usr/bin/env python3
"""
tactics_uxsim_adapter.py

Closed-loop adaptive traffic light simulation in UXsim using the TACTICS
fuzzy reactive controller (Cosariu et al. 2015).

At each UXsim timestep, for every signalized node:
  1. Compute speed ratio from incoming vehicle speeds vs free-flow speed
  2. Estimate queue fraction from speed ratio
  3. Run TACTICS fuzzy inference to get delta-green adjustment
  4. Apply the adjustment to the node's current green phase duration

This replaces the static phase programs with adaptive ones driven by
real probe-derived arrival rates.

────────────────────────────────────────────────────────────────────────────
USAGE
────────────────────────────────────────────────────────────────────────────

    python3 scripts/tactics_uxsim_adapter.py              # all scenarios
    python3 scripts/tactics_uxsim_adapter.py --scenario TM-03  # single scenario
    python3 scripts/tactics_uxsim_adapter.py --compare        # compare adaptive vs static

────────────────────────────────────────────────────────────────────────────
KEY DIFFERENCE FROM STATIC UXSIM ADAPTER
────────────────────────────────────────────────────────────────────────────

The static adapter (uxsim-adapter.py) uses fixed phase programs.
The TACTICS adapter uses per-timestep fuzzy inference to adapt green times:
  - Heavy congestion (low speed ratio) → extend green
  - Light congestion (high speed ratio) → cut green
  - Peak hours (morning/afternoon rush) → ×1.3 multiplier
  - Night / late night → ×0.7 multiplier

"""

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ─── TACTICS fuzzy controller (Python port of tacticsControl.mjs) ──────────────

REGIME_THRESHOLDS = {"free": 0.85, "light": 0.65, "heavy": 0.40}


def classify_regime(speed_ratio):
    if speed_ratio >= REGIME_THRESHOLDS["free"]:
        return "free"
    if speed_ratio >= REGIME_THRESHOLDS["light"]:
        return "light"
    if speed_ratio >= REGIME_THRESHOLDS["heavy"]:
        return "heavy"
    return "blocked"


def classify_slot(hour):
    if 0 <= hour < 6:
        return "night"
    if 6 <= hour < 8:
        return "morning-rush"
    if 8 <= hour < 10:
        return "mid-morning"
    if 10 <= hour < 14:
        return "midday"
    if 14 <= hour < 17:
        return "afternoon-rush"
    if 17 <= hour < 21:
        return "evening"
    return "late-night"


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def fuzzy_speed_ratio(v):
    """Returns {blocked, heavy, light, free} memberships for speed ratio v in [0,1]."""
    return {
        "blocked": clamp((0.40 - v) / 0.40, 0, 1),
        "heavy": (
            clamp((v - 0.40) / 0.25, 0, 1) * clamp((0.65 - v) / 0.25, 0, 1)
            + (0 if v >= 0.40 else clamp((v - 0.40) / 0.25, 0, 1))
            * (0 if v >= 0.65 else clamp((0.65 - v) / 0.25, 0, 1))
        ),
        "light": clamp((v - 0.65) / 0.20, 0, 1) * clamp((0.85 - v) / 0.20, 0, 1),
        "free": clamp((v - 0.85) / 0.15, 0, 1),
    }


def fuzzy_queue_length(q):
    """Returns {short, medium, long, saturated} memberships for queue q in [0,1]."""
    return {
        "short": clamp(1 - q * 2, 0, 1),
        "medium": (
            clamp((q - 0.25) * 4, 0, 1) * clamp((0.75 - q) * 4, 0, 1)
            + (clamp(q * 4, 0, 1) if q <= 0.25 else 0)
        ),
        "long": clamp((q - 0.5) * 2, 0, 1),
        "saturated": clamp((q - 0.75) * 4, 0, 1),
    }


def fuzzy_time_of_day(hour):
    """Returns time-of-day memberships."""
    return {
        "night": 1.0 if hour < 6 else 0.0,
        "morning": 1.0 if 6 <= hour < 10 else 0.0,
        "midday": 1.0 if 10 <= hour < 14 else 0.0,
        "afternoon": 1.0 if 14 <= hour < 19 else 0.0,
        "evening": 1.0 if 19 <= hour < 22 else 0.0,
        "late": 1.0 if hour >= 22 or hour < 6 else 0.0,
    }


# TACTICS Mamdani-style fuzzy rules
# IF queue IS {short|medium|long|saturated} AND speed IS {blocked|heavy|light|free}
# THEN delta_green = weight * speed_ratio + bias
RULES = [
    {"queue": "saturated", "speed": "blocked", "weight": 2.5, "bias": 8},
    {"queue": "saturated", "speed": "heavy", "weight": 2.0, "bias": 5},
    {"queue": "long", "speed": "blocked", "weight": 1.5, "bias": 4},
    {"queue": "long", "speed": "heavy", "weight": 1.0, "bias": 2},
    {"queue": "long", "speed": "light", "weight": -0.8, "bias": -1},
    {"queue": "medium", "speed": "blocked", "weight": 1.0, "bias": 2},
    {"queue": "medium", "speed": "free", "weight": -1.2, "bias": -3},
    {"queue": "short", "speed": "free", "weight": -2.0, "bias": -5},
    {"queue": "short", "speed": "light", "weight": -1.0, "bias": -2},
    {"queue": "short", "speed": "blocked", "weight": 0.5, "bias": 1},
    {"queue": "saturated", "speed": "light", "weight": 0.8, "bias": 2},
    {"queue": "saturated", "speed": "free", "weight": 0.5, "bias": 1},
    {"queue": "medium", "speed": "heavy", "weight": 0.6, "bias": 1},
    {"queue": "medium", "speed": "light", "weight": 0.3, "bias": 0},
    {"queue": "long", "speed": "free", "weight": -1.5, "bias": -3},
    {"queue": "long", "speed": "light", "weight": -0.8, "bias": -1},
]


def compute_tactics_adjustment(speed_ratio, queue_fraction, hour):
    """
    Returns delta-green time adjustment in seconds.
    speed_ratio: 0..1 (current speed / free-flow speed)
    queue_fraction: 0..1 (0=free, 1=saturated)
    hour: 0..23
    """
    speed_memberships = fuzzy_speed_ratio(speed_ratio)
    queue_memberships = fuzzy_queue_length(queue_fraction)
    time_memberships = fuzzy_time_of_day(hour)

    # Time-of-day multiplier
    if time_memberships.get("morning") or time_memberships.get("afternoon"):
        time_mult = 1.3
    elif time_memberships.get("midday"):
        time_mult = 1.1
    elif time_memberships.get("evening"):
        time_mult = 0.9
    else:
        time_mult = 0.7

    total_weight = 0.0
    weighted_sum = 0.0

    for rule in RULES:
        q_mu = queue_memberships.get(rule["queue"], 0)
        s_mu = speed_memberships.get(rule["speed"], 0)
        t_mu = max(time_memberships.values())  # simplified: any time fires

        activation = min(q_mu, s_mu, t_mu)
        if activation > 0.01:
            delta = (rule["weight"] * speed_ratio + rule["bias"]) * time_mult
            weighted_sum += activation * delta
            total_weight += activation

    if total_weight < 0.01:
        return 0.0
    return clamp(weighted_sum / total_weight, -10, 10)


def estimate_queue_fraction(speed_ratio, regime):
    """Convert speed ratio to queue fraction estimate."""
    if regime == "free":
        return clamp(1 - (speed_ratio - 0.85) / 0.15 * 0.15, 0, 0.15)
    if regime == "light":
        return clamp(0.15 + (0.85 - speed_ratio) / 0.20 * 0.25, 0.15, 0.40)
    if regime == "heavy":
        return clamp(0.40 + (0.65 - speed_ratio) / 0.25 * 0.30, 0.40, 0.70)
    return clamp(0.70 + (0.40 - speed_ratio) / 0.40 * 0.30, 0.70, 1.0)


def adapt_signal_program(phases, speed_ratio, hour):
    """
    Given a list of phase dicts [{state, durationSeconds}], return new phases
    with adapted green durations using TACTICS.
    """
    regime = classify_regime(speed_ratio)
    queue_fraction = estimate_queue_fraction(speed_ratio, regime)
    delta_green = compute_tactics_adjustment(speed_ratio, queue_fraction, hour)

    adapted = []
    for phase in phases:
        state = phase.get("state", "")
        dur = phase.get("durationSeconds", 0)
        if state == "green":
            new_dur = max(10, dur + round(delta_green))
        else:
            new_dur = dur
        adapted.append({**phase, "durationSeconds": new_dur})

    return adapted, round(delta_green, 1), regime, round(queue_fraction, 2)


# ─── Data loading ────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent.resolve()
OUTPUT_DIR = REPO_ROOT / "data" / "uxsim"
OUTPUT_DIR.mkdir(exist_ok=True)


def load_signals():
    with open(REPO_ROOT / "data" / "traffic-lights" / "signals.json") as f:
        return json.load(f)


def load_scenarios():
    with open(REPO_ROOT / "data" / "scenarios.json") as f:
        return json.load(f)


def load_arrival_model():
    with open(REPO_ROOT / "data" / "derived" / "arrival-model.json") as f:
        return json.load(f)


def load_calibration():
    with open(REPO_ROOT / "data" / "derived" / "calibration-results.json") as f:
        return json.load(f)


def load_framework_results():
    with open(REPO_ROOT / "data" / "traffic-lights" / "analysis" / "framework-results.json") as f:
        return json.load(f)


def load_real_ground_truth():
    with open(REPO_ROOT / "data" / "uxsim" / "ground-truth-real.json") as f:
        return json.load(f)


# ─── Corridor network builder (shared with uxsim-adapter.py) ──────────────────

OSM_KEYWORDS_BY_SCENARIO = {
    "TM-01": ["Republicii"],
    "TM-02": ["Aradului"],
    "TM-03": ["Șagului"],
    "TM-04": ["Circumvalațiunii"],
}


def haversine_m(a, b):
    R = 6_371_000
    dlat = math.radians(b[1] - a[1])
    dlon = math.radians(b[0] - a[0])
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    v = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(v), math.sqrt(1 - v))


def meters_per_deg_lat(lat):
    return 111320.0


def meters_per_deg_lng(lat):
    return 111320.0 * math.cos(math.radians(lat))


def phases_to_uxsim_signal(phases):
    """Convert OpenTrafficTM phases to UXsim signal list."""
    uxsim_signal = []
    for ph in phases:
        state = ph.get("state", "")
        dur = ph.get("durationSeconds", 0)
        if state == "green":
            uxsim_signal.append(dur)
        elif state in ("yellow", "red"):
            uxsim_signal.append(dur)
    return uxsim_signal if uxsim_signal else [90]


def time_slot_to_seconds(slot):
    mapping = {
        "night": 0,
        "morning-rush": 7 * 3600,
        "mid-morning": 10 * 3600,
        "midday": 12 * 3600,
        "afternoon-rush": 17 * 3600,
        "evening": 19 * 3600,
        "late-night": 22 * 3600,
    }
    return mapping.get(slot, 0)


def build_corridor_network(scenario_id, signals_data, framework_data,
                           arrival_data, calibration_data, real_gt_data):
    """Same as uxsim-adapter.py build_corridor_network, but returns extra metadata."""
    scenario = next((s for s in load_scenarios() if s["id"] == scenario_id), None)
    if not scenario:
        raise ValueError(f"Unknown scenario {scenario_id}")

    corridor_name = scenario["corridor"]
    real_gt = real_gt_data.get("scenarios", {}).get(scenario_id, {})
    ground_truth_delay = real_gt.get("consensus_delay_s")
    if ground_truth_delay is None:
        ground_truth_delay = scenario["groundTruth"]

    signal_ids = scenario.get("signalIds", [])
    id_to_sig = {s["id"]: s for s in signals_data.get("programs", [])}
    corridor_signals = [id_to_sig[sid] for sid in signal_ids if sid in id_to_sig]

    if not corridor_signals:
        print(f"  [WARN] No signals found for corridor '{corridor_name}'")
        return None

    # Sort by longitude
    corridor_signals = sorted(corridor_signals,
                               key=lambda s: s.get("position", {}).get("lng", 0))

    city_defaults = calibration_data.get("defaults", {})
    desired_speed_ms = (city_defaults.get("desiredSpeedKph", 29) or 29) / 3.6
    time_gap_s = city_defaults.get("timeGapSeconds", 15.7) or 15.7
    jam_density = 1.0 / (desired_speed_ms * time_gap_s) if desired_speed_ms > 0 else 0.2

    nodes = []
    for i, sig in enumerate(corridor_signals):
        pos = sig.get("position", {})
        phases = sig.get("phases", [])
        offset = sig.get("offsetSeconds", 0)
        fw_result = next(
            (r for r in framework_data.get("intersectionResults", [])
             if r.get("lightId") == sig.get("id")), {}
        )
        cycle_length = fw_result.get("cycleMAP", 90)
        nodes.append({
            "name": f"n{i}",
            "x": pos.get("lng", 0),
            "y": pos.get("lat", 0),
            "signal": phases_to_uxsim_signal(phases),
            "signal_offset": offset % cycle_length if cycle_length else 0,
            "cycle_length": cycle_length,
            "sample_count": sig.get("sampleCount", 0),
            "signal_id": sig.get("id"),
            "phases": phases,  # keep original phases for TACTICS adaptation
            "original_phases": phases,  # base phases
        })

    links = []
    for i in range(len(nodes) - 1):
        n1 = nodes[i]
        n2 = nodes[i + 1]
        dlat = n2["y"] - n1["y"]
        dlng = n2["x"] - n1["x"]
        avg_lat = (n1["y"] + n2["y"]) / 2
        dist_m = math.sqrt(
            (dlat * meters_per_deg_lat(avg_lat)) ** 2 +
            (dlng * meters_per_deg_lng(avg_lat)) ** 2
        )
        if dist_m < 10:
            continue
        links.append({
            "name": f"l{i}",
            "start": n1["name"],
            "end": n2["name"],
            "length": dist_m,
            "u": desired_speed_ms,
            "kappa": jam_density,
            "merge_priority": 1,
            "signal_group": 0,
            "signal_id": n1["signal_id"],
        })

    connected = set()
    for lk in links:
        connected.add(lk["start"])
        connected.add(lk["end"])
    nodes = [n for n in nodes if n["name"] in connected]

    # Connected component filter
    if len(nodes) > 0:
        adj = {n["name"]: [] for n in nodes}
        for lk in links:
            if lk["start"] in adj and lk["end"] in adj:
                adj[lk["start"]].append(lk["end"])
                adj[lk["end"]].append(lk["start"])
        visited = set()
        components = []
        for n in nodes:
            if n["name"] not in visited:
                comp = []
                queue = [n["name"]]
                while queue:
                    name = queue.pop(0)
                    if name in visited:
                        continue
                    visited.add(name)
                    comp.append(name)
                    for nb in adj.get(name, []):
                        if nb not in visited:
                            queue.append(nb)
                components.append(comp)
        if len(components) > 1:
            largest = max(components, key=len)
            valid = set(largest)
            nodes = [n for n in nodes if n["name"] in valid]
            links = [lk for lk in links
                     if lk["start"] in valid and lk["end"] in valid]

    valid_names = {n["name"] for n in nodes}
    links = [lk for lk in links if lk["start"] in valid_names and lk["end"] in valid_names]

    # Demands from arrival model (same as uxsim-adapter.py)
    time_slots = ["morning-rush", "midday", "afternoon-rush", "evening"]
    demands = []
    if len(nodes) >= 2:
        origin = nodes[0]["name"]
        dest = nodes[-1]["name"]
        total_dist = sum(lk["length"] for lk in links)

        for slot in time_slots:
            origin_sid = nodes[0]["signal_id"]
            slot_demand = 0.0
            for approach in arrival_data.get("approaches", []):
                if (approach.get("signalId") == origin_sid and
                        approach.get("timeSlot") == slot):
                    avg_delay = approach.get("avgDelaySeconds", 0)
                    if avg_delay > 0:
                        if avg_delay < 5:
                            flow = 0.005
                        elif avg_delay < 15:
                            flow = 0.005 + (avg_delay - 5) * 0.001
                        elif avg_delay < 25:
                            flow = 0.015 + (avg_delay - 15) * 0.0025
                        else:
                            flow = 0.040 + (avg_delay - 25) * 0.001
                        slot_demand = min(flow, 0.06)
                    break

            if slot_demand > 0:
                start_t = time_slot_to_seconds(slot)
                demands.append({
                    "orig": origin,
                    "dest": dest,
                    "start_t": start_t,
                    "end_t": start_t + 7200,
                    "flow": slot_demand,
                    "slot": slot,
                })

    return {
        "scenario_id": scenario_id,
        "corridor": corridor_name,
        "ground_truth_delay": ground_truth_delay,
        "nodes": nodes,
        "links": links,
        "demands": demands,
    }


# ─── TACTICS user function factory ─────────────────────────────────────────────

def make_tactics_user_function(node_name, original_phases, speed_ratio_by_hour, free_flow_speed_ms):
    """
    Returns a user_function that adapts signal timing using TACTICS each timestep.
    The returned function closes over node metadata.
    """
    # Pre-compute per-hour TACTICS adaptations for the base phases
    adaptations_by_hour = {}
    for hour in range(24):
        adapted, delta, regime, qfrac = adapt_signal_program(original_phases, 0.55, hour)
        adaptations_by_hour[hour] = {
            "phases": adapted,
            "delta_green": delta,
            "regime": regime,
            "queue_fraction": qfrac,
        }

    # Default adaptation (use midday)
    current_phases = list(original_phases)
    current_signal = phases_to_uxsim_signal(current_phases)

    def user_function(node):
        """
        Called by UXsim at every timestep with the node object.
        We read current vehicle speeds to estimate speed ratio,
        run TACTICS, and modify the node's signal in-place.
        """
        nonlocal current_phases, current_signal

        t = node.signal_t
        sig = node.signal
        phase_idx = node.signal_phase

        # Get current hour from simulation time
        sim_t = node.W.T if hasattr(node, "W") else 0
        hour = int(sim_t / 3600) % 24

        # Compute speed ratio from incoming vehicles
        # incoming_vehicles is a list, not a dict
        incoming = node.incoming_vehicles
        if incoming and len(incoming) > 0:
            speeds = []
            for v in incoming:
                if hasattr(v, "Speed") and v.Speed > 0:
                    speeds.append(v.Speed)
                elif hasattr(v, "speed") and v.speed > 0:
                    speeds.append(v.speed)
            if speeds:
                avg_speed = sum(speeds) / len(speeds)
                speed_ratio = avg_speed / free_flow_speed_ms
                speed_ratio = clamp(speed_ratio, 0.1, 1.0)
            else:
                speed_ratio = 0.55
        else:
            speed_ratio = 0.9

        # Get TACTICS adaptation for this hour
        adapt = adaptations_by_hour.get(hour, adaptations_by_hour[12])
        delta = adapt["delta_green"]

        # Only update if delta is significant (avoid every-timestep churn)
        if abs(delta) >= 2:
            adapted, _, _, _ = adapt_signal_program(original_phases, speed_ratio, hour)
            new_signal = phases_to_uxsim_signal(adapted)
            # Apply to node
            node.signal = new_signal
            current_signal = new_signal
            current_phases = adapted

    return user_function


# ─── Simulation runner ──────────────────────────────────────────────────────────

def run_tactics_simulation(network, scenario_id, output_dir, compare_static=False):
    """Run UXsim with TACTICS adaptive signals."""
    try:
        from uxsim import World, Analyzer
    except ImportError:
        return {"error": "UXsim not installed. Install with: pip install uxsim"}

    scenario_dir = output_dir / scenario_id
    scenario_dir.mkdir(exist_ok=True)

    nodes = network["nodes"]
    links = network["links"]
    demands = network["demands"]

    tmax = 8 * 3600
    free_flow_speed_ms = 8.06

    # Build UXsim network
    W = World(
        name=scenario_id,
        deltan=5,
        tmax=tmax,
        print_mode=0,
        save_mode=1,
        show_mode=0,
        random_seed=42,
    )

    # Add nodes with TACTICS user functions
    node_objs = {}
    for n in nodes:
        phases = n.get("phases", n.get("original_phases", []))
        adapt_fn = make_tactics_user_function(
            n["name"], phases, {}, free_flow_speed_ms
        )
        node_obj = W.addNode(
            n["name"],
            float(n["x"]),
            float(n["y"]),
            signal=n["signal"],
            signal_offset=n["signal_offset"],
            user_function=adapt_fn,
        )
        node_objs[n["name"]] = node_obj

    # Add links
    for lk in links:
        W.addLink(
            lk["name"], lk["start"], lk["end"],
            length=float(lk["length"]),
            free_flow_speed=float(lk["u"]),
            jam_density=float(lk["kappa"]),
            merge_priority=int(lk["merge_priority"]),
            signal_group=int(lk["signal_group"]) if lk.get("signal_group") else 0,
        )

    # Add demands
    for d in demands:
        W.adddemand(d["orig"], d["dest"], float(d["start_t"]), float(d["end_t"]), float(d["flow"]))

    # Run simulation
    W.exec_simulation()

    # Analyze results
    analyzer = Analyzer(W)
    trip_stats = analyzer.vehicle_trip_to_pandas()

    total_delay = 0.0
    total_trips = 0
    completed = 0
    wait_count = 0
    abort_count = 0

    if len(trip_stats) > 0:
        link_stats = analyzer.link_to_pandas()
        link_lengths = link_stats["length"].tolist() if len(link_stats) > 0 else []
        total_dist = sum(link_lengths)
        corridor_free_tt = total_dist / free_flow_speed_ms if total_dist > 0 else 165

        for _, trip in trip_stats.iterrows():
            dist = trip.get("distance_traveled", 0)
            tt = trip.get("travel_time", 0)
            final_state = trip.get("final_state", "")

            if final_state == "wait":
                wait_count += 1
                continue
            if final_state == "abort":
                abort_count += 1
                continue
            if final_state == "end" and dist > 0:
                free_tt = dist / free_flow_speed_ms
                delay = max(0, tt - free_tt)
                total_delay += delay
                total_trips += 1
                completed += 1

    avg_delay = total_delay / total_trips if total_trips > 0 else 0.0
    ground_truth = network["ground_truth_delay"]
    error = abs(avg_delay - ground_truth)

    result = {
        "scenario_id": scenario_id,
        "corridor": network["corridor"],
        "ground_truth_delay_s": ground_truth,
        "uxsim_delay_s": round(float(avg_delay), 2),
        "error_s": round(float(error), 2),
        "total_trips": int(total_trips),
        "avg_travel_time_s": round(float(total_delay / completed if completed > 0 else 0), 2),
        "nodes": len(nodes),
        "links": len(links),
        "demands": len(demands),
        "mode": "tactics-adaptive",
        "wait_count": wait_count,
        "abort_count": abort_count,
    }

    result_path = scenario_dir / "result-tactics-adaptive.json"
    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)

    status = "✓" if error < 3.0 else "✗"
    print(f"  {status} {scenario_id} ({network['corridor']}) [TACTICS-adaptive]: "
          f"ground={ground_truth:.1f}s, uxsim={avg_delay:.1f}s, error={error:.1f}s")

    return result


# ─── CSV writers ──────────────────────────────────────────────────────────────

def write_nodes_csv(network, path):
    with open(path, "w") as f:
        f.write("name,x,y,signal,signal_offset\n")
        for n in network["nodes"]:
            sig_str = '"' + ",".join(str(d) for d in n["signal"]) + '"' if n["signal"] else '"90"'
            f.write(f"{n['name']},{n['x']:.6f},{n['y']:.6f},{sig_str},{n.get('signal_offset', 0)}\n")


def write_links_csv(network, path):
    with open(path, "w") as f:
        f.write("name,start,end,length,u,kappa,merge_priority,signal_group\n")
        for lk in network["links"]:
            f.write(f"{lk['name']},{lk['start']},{lk['end']},"
                    f"{lk['length']:.1f},{lk['u']:.2f},{lk['kappa']:.4f},"
                    f"{lk['merge_priority']},{lk['signal_group']}\n")


def write_demand_csv(network, path):
    with open(path, "w") as f:
        f.write("orig,dest,start_t,end_t,q\n")
        for d in network["demands"]:
            f.write(f"{d['orig']},{d['dest']},{d['start_t']},{d['end_t']},{d['flow']:.6f}\n")


# ─── Main ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="TACTICS-adaptive UXsim simulation")
    parser.add_argument("--scenario", choices=["TM-01", "TM-02", "TM-03", "TM-04"],
                        help="Run specific scenario only")
    parser.add_argument("--compare", action="store_true",
                        help="Also run static baseline for comparison")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR),
                        help=f"Output directory (default: {OUTPUT_DIR})")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)

    print("\n=== TACTICS-Adaptive UXsim ===\n")

    signals_data = load_signals()
    scenarios_data = load_scenarios()
    arrival_data = load_arrival_model()
    calibration_data = load_calibration()
    framework_data = load_framework_results()
    real_gt_data = load_real_ground_truth()

    print(f"  signals: {len(signals_data.get('programs', []))}")
    print(f"  scenarios: {len(scenarios_data)}")
    print(f"  arrival approaches: {len(arrival_data.get('approaches', []))}")
    print(f"  real ground truth: {len(real_gt_data.get('scenarios', {}))} scenarios")

    scenario_ids = [args.scenario] if args.scenario else [s["id"] for s in scenarios_data]

    tactics_results = []
    static_results = []

    for sid in scenario_ids:
        print(f"\nProcessing {sid}...")
        try:
            network = build_corridor_network(sid, signals_data, framework_data,
                                              arrival_data, calibration_data, real_gt_data)
            if not network:
                continue
            print(f"  nodes={len(network['nodes'])}, links={len(network['links'])}, "
                  f"demands={len(network['demands'])}")

            # Write base CSVs (for reference)
            sc_dir = output_dir / sid
            sc_dir.mkdir(exist_ok=True)
            write_nodes_csv(network, sc_dir / "nodes.csv")
            write_links_csv(network, sc_dir / "links.csv")
            write_demand_csv(network, sc_dir / "demand.csv")

            # Run TACTICS-adaptive simulation
            r = run_tactics_simulation(network, sid, output_dir)
            tactics_results.append(r)

        except Exception as e:
            print(f"  [ERROR] {e}")
            import traceback
            traceback.print_exc()

    # Summary
    if tactics_results:
        print("\n=== TACTICS-Adaptive Results ===")
        print(f"{'Scenario':<8} {'Corridor':<30} {'Ground':<8} {'UXsim':<8} {'Error':<8}")
        print("-" * 65)
        for r in tactics_results:
            print(f"{r['scenario_id']:<8} {r['corridor']:<30} "
                  f"{r['ground_truth_delay_s']:<8.1f} {r['uxsim_delay_s']:<8.1f} "
                  f"{r['error_s']:<8.1f}")

        # Save adaptive results
        out_path = output_dir / "tactics-adaptive-results.json"
        with open(out_path, "w") as f:
            json.dump(tactics_results, f, indent=2)
        print(f"\nResults saved to {out_path}")


if __name__ == "__main__":
    main()