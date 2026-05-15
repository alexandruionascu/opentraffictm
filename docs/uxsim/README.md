# UXsim Integration

**Probe-calibrated mesoscopic traffic simulation for Timișoara**

This directory contains the integration between OpenTrafficTM's probe-derived arrival model and [UXsim](https://github.com/toruseo/UXsim), a Python mesoscopic traffic simulator using Newell's simplified car-following model.

---

## Quick Start

```bash
# Run all 4 scenarios
python3 scripts/uxsim-adapter.py

# Run specific scenario
python3 scripts/uxsim-adapter.py --scenario TM-03

# Historical time-series only
python3 scripts/uxsim-adapter.py --hist
```

---

## What This Does

The adapter converts OpenTrafficTM data into UXsim networks and demand matrices, then validates simulation output against probe-observed ground-truth delays.

**Input data:**
- `data/traffic-lights/signals.json` — 1,131 signals with phase programs
- `data/scenarios.json` — 4 corridors with ground-truth delay values
- `data/derived/arrival-model.json` — 7,639 signal-approach × time-slot distributions
- `data/traffic-lights/analysis/framework-results.json` — cycle lengths, offsets, confidence
- `data/derived/calibration-results.json` — IDM defaults (desired speed, time gap, jam density)

**Output:** `data/uxsim/` — per-scenario nodes/links/demand CSVs + validation results

---

## Method

### Network Building

For each scenario:
1. **Signal matching** — signals within 80m of OSM road segments matching the corridor keyword
2. **Sort** — signals sorted by longitude (for E-W corridors)
3. **Link creation** — consecutive signals linked with haversine distances
4. **Topology filter** — largest connected component kept; isolated nodes removed (<30m gaps filtered)
5. **Signal assignment** — per-node signal timing `[green, yellow, red]` from phases.json

### Demand Calibration

Probe-observed `avgDelay` (seconds per approach × slot) → UXsim demand flow (veh/s):

```
avgDelay < 5s  → flow = 0.005 (base)
5s ≤ avgDelay < 15s → flow = 0.005 + (avgDelay - 5) × 0.001
15s ≤ avgDelay < 25s → flow = 0.015 + (avgDelay - 15) × 0.0025
avgDelay ≥ 25s → flow = 0.040 (capped)
```

**Calibration basis:** UXsim isolated 3-link corridor (3 × 400m links, 8.06 m/s free-flow, 117s signal cycle):
- `flow=0.01 veh/s` → `~10s delay`
- `flow=0.03 veh/s` → `~16s delay`
- `flow=0.04 veh/s` → `~11s delay` (queue clears)
- `flow≥0.05 veh/s` → massive saturation (hundreds of seconds)

### Delay Computation

`delay = actual_travel_time − free_flow_travel_time`

- Only **"end" state vehicles** (completed the corridor) count
- WAIT/ABORT vehicles excluded (extreme saturation, outside normal operating conditions)
- Free-flow travel time = `distance / 8.06 m/s`

---

## Results

```
UXsim Validation Results (current state):
Scenario     Ground Truth    UXsim Delay    Error    Nodes    Links    Status
----------------------------------------------------------------------------
TM-01              11.2s          35.0s      23.8s       4        3    Topology + calibration
TM-02               8.7s           0.4s       8.3s       2        1    Topology collapse
TM-03              13.4s           2.3s      11.1s       2        1    Topology collapse
TM-04               9.6s          19.9s      10.3s       4        3    Topology + calibration

All 4 scenarios show errors > 8s due to two compounding issues:
1. The 30m link filter drops valid consecutive signals, collapsing corridors
2. Demand calibration curve was fitted for a single corridor length

Prior versions claiming "TM-03 validated at 0.0s error" were incorrect —
that result came from a smaller signal cluster no longer present after
proper corridor reconstruction.
```

### What the Errors Tell Us

The topology collapse (TM-02/03 reduced to 2 nodes) and calibration failures (TM-01/04 off by 20+s) reveal that the signal chain construction and demand calibration are both research artifacts, not production-ready components. The TACTICS fuzzy controller (0.4s error across all 4 scenarios) is the more reliable result.

---

## File Structure

```
data/uxsim/
├── TM-01/
│   ├── nodes.csv    # name, x(lng), y(lat), signal, signal_offset
│   ├── links.csv    # name, start, end, length, u(free-flow m/s), kappa, merge_priority, signal_group
│   └── demand.csv   # orig, dest, start_t, end_t, q(flow veh/s)
├── TM-02/  (same structure)
├── TM-03/  (same structure)
├── TM-04/  (same structure)
├── validation-results.json   # Ground vs UXsim comparison
└── historical-analysis.json   # TomTom archive by time slot
```

---

## Reusing the Adapter

The adapter can be repurposed for any corridor by editing `data/scenarios.json`:

```json
{
  "id": "YOUR-CORRIDOR-ID",
  "corridor": "Your Street Name",
  "groundTruth": 10.5,
  "signalIds": ["signal-123", "signal-456", ...]  // optional explicit list
}
```

If `signalIds` is omitted, the adapter falls back to OSM keyword matching with all its limitations (disconnected clusters, parallel road signals). For production use, always provide explicit signal IDs.

### Dependencies

```bash
pip install uxsim pandas
```

---

## Limitations

1. **The `dist_m < 30` link filter is too aggressive** — it drops valid consecutive signals at urban intersections where carriageways are <30m apart. This collapses corridors to 2-4 nodes, making delay comparison meaningless. **Workaround:** remove the filter or raise to 150m.

2. **Single-corridor demand calibration** — the flow→delay curve was fitted on a 3×400m, 117s cycle corridor. It does not generalize when corridor length changes. Each topology needs its own calibration.

3. **Ground truth is from TACTICS benchmark** — the "ground truth" delay values (8.7s–13.4s) are expected delay reductions from adaptive signal control, not measured corridor delays under baseline conditions.

4. **Signal chain construction is heuristic** — OSM road centerline projection → 80m buffer → 25m clustering → 200m chaining produces reasonable chains for some corridors but fails when OSM geometry diverges from actual signal locations.

5. **Wait/Abort exclusion** — in saturated conditions, most vehicles never complete the corridor. Counting only "end" state vehicles underestimates delay for heavy congestion scenarios.

---

## What's Next

1. **Fix TM-01/02/04 topology** — add explicit `signalIds` to scenarios.json
2. **Multi-corridor calibration** — fit calibration curve across all scenarios
3. **Real-time loop** — STPT live → queue estimator → TACTICS → UXsim validation
4. **SUMO co-simulation** — cross-validate UXsim results against SUMO
5. **RL policy training** — UXsim + arrival model → trained signal control agent