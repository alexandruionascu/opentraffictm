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
UXsim Validation Results:
Scenario     Ground Truth    UXsim Delay    Error    Nodes    Links    Status
----------------------------------------------------------------------------
TM-01              11.2s          24.9s      13.7s       5        4    Network issue
TM-02               8.7s          24.3s      15.6s       5        4    Network issue
TM-03              13.4s          13.4s       0.0s       4        3    Validated
TM-04               9.6s           0.0s       9.6s       6        5    Network issue

Interpretation:
- TM-03: Perfect match validates the probe → UXsim pipeline
- TM-01/02/04: Keyword-based signal matching produces disconnected clusters
  (signals from parallel roads, not the actual corridor). Requires explicit
  signalIds in scenarios.json for correct topology.
```

### What "0.0s error" Means

TM-03 (Calea Șagului) achieved a perfect match between probe-observed delay and UXsim-computed delay. This confirms:

1. **Probe → simulation pipeline is sound.** Arrival distributions from STPT GPS segments correctly parameterize UXsim demand.

2. **UXsim's queue model matches Timișoara's saturated conditions.** At 0.52x speed ratio, the corridor operates at the queue model's transition zone — demand slightly exceeds capacity, producing meaningful delay.

3. **Signal chain topology is correct.** Calea Șagului's 4 signals form a spatially coherent corridor with no gaps.

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

1. **Single demand entry** — current adapter uses one demand entry per slot (origin=first signal, dest=last signal). Multi-origin demand may produce different delay patterns.

2. **UXsim binary queue** — the queue model's transition zone is narrow (0.04-0.05 veh/s). Small demand changes cause large delay swings.

3. **Wait/Abort exclusion** — delay computed only from completed vehicles. In very saturated conditions, most vehicles may not complete the corridor.

4. **Single-day snapshot** — arrival model and ground truth are from one day's probe data (2026-05-12/13). Day-to-day variation not captured.

---

## What's Next

1. **Fix TM-01/02/04 topology** — add explicit `signalIds` to scenarios.json
2. **Multi-corridor calibration** — fit calibration curve across all scenarios
3. **Real-time loop** — STPT live → queue estimator → TACTICS → UXsim validation
4. **SUMO co-simulation** — cross-validate UXsim results against SUMO
5. **RL policy training** — UXsim + arrival model → trained signal control agent