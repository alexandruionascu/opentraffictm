# OpenTrafficTM — Agent Reference

**What this is:** Traffic analysis platform for Timișoara, Romania. Combines STPT bus GPS probes, TomTom traffic flow data, and browser-native simulation to analyze congestion, infer signal timing, and model traffic dynamics.

**Data window:** ~67 hours of STPT probe data (2026-05-12 20:13 → 2026-05-15 11:42).

---

## City-Wide Key Numbers

| Metric | Value |
|--------|-------|
| City-wide avg transit speed | **19.4 km/h** |
| City-wide avg delay | **18.7 s** |
| TomTom speed ratio | **0.921x** free-flow |
| Travel Time Index (TTI) | **0.63** (travel 63% longer than free-flow) |
| Buffer Index (BI) | **0.40** (40% travel time variability — moderately unreliable) |
| Probe segments analyzed | **897,748** |
| Routes calibrated | **57** (8 high-quality) |
| Anomaly routes (probe vs TomTom >20% disagreement) | **23** |
| Signal approaches in heavy/blocked regime | **83%** |

---

## Slowest Corridors

| Route | Avg Speed | Delay | Speed Ratio | Kerner Regime |
|-------|-----------|-------|-------------|---------------|
| V1 | 8.8 km/h | 32.8 s | 0.18 | **blocked** |
| 16 | 14.2 km/h | 26.2 s | 0.28 | **heavy** |
| 18 | 14.5 km/h | 25.3 s | 0.29 | **heavy** |
| 14 | 14.7 km/h | 24.6 s | 0.29 | **heavy** |
| 15 | 14.8 km/h | 25.4 s | 0.30 | **heavy** |

---

## Kerner Three-Phase Congestion Breakdown

| Regime | Count | % | Speed Ratio Range |
|--------|-------|---|---|
| free | 52 | 44% | ≥ 0.85 |
| light | 17 | 14% | 0.65–0.85 |
| **synchronized** | 22 | 19% | 0.40–0.65 |
| **heavy** | 26 | 22% | 0.25–0.40 |
| blocked | 1 | 1% | < 0.25 |

The 44% "free" count is misleading — it includes lightly trafficked side streets. The signal-level analysis (83% heavy/blocked) is the more meaningful figure.

---

## Car-Following Calibration Defaults (city-wide averages)

From 57 routes calibrated on STPT bus probe data (8 high-quality routes with ≥5,000 segments):

| Model | Parameter | Value |
|-------|-----------|-------|
| IDM | desiredSpeed | 29 km/h |
| IDM | timeGap | 15.7 s |
| IDM | maxAccel | 3.55 m/s² |
| IDM | comfortDecel | 3.43 m/s² |
| Newell | deltaSeconds | 1.6–1.8 s |
| Newell | waveSpeedKph | 12 km/h |
| Gipps | desiredSpeed | 28–30.7 km/h |
| Gipps | maxBrakeMps2 | 2.0 m/s² |

The high time gap (15.7s vs typical 1–2s for cars) is because these are **buses**, not passenger cars — they maintain large gaps for boarding/alighting safety. Wave speed is uniformly 12 km/h across all routes — the queue discharge rate is constant city-wide.

---

## Queue Length Estimation from GPS Probes

**Method:** When a bus is slow (< 12 km/h) or stopped near a signal (within 180m, heading toward it), the distance from the bus to the stop line tells us how many vehicles are queued ahead.

```
effectiveGap = (vehicleLength + 2.8m) + v_mps × T_queue
vehiclesAhead = floor((distanceToStopLine − 9.5m) / effectiveGap)
```

The **1.5s queue time gap** is used (not the 15.7s calibration time gap) — 1.5s is the jam-density baseline appropriate for queue geometry at signals. At rest this gives 7.6m gap per vehicle; at 10 km/h it gives ~12m.

**Results from 500k probe observations (995 signals):**

| Queue Metric | Value |
|-------------|-------|
| Signals with queue observations | **995** |
| Signals with median queue > 0 | **138 (14%)** |
| Signals with median queue ≥ 5 | **25** |
| Signals with median queue ≥ 10 | **12** |
| Max median queue | **20 vehicles** |

**Top congested signals:**

| Signal | Median Queue | p95 Queue | Samples |
|--------|-------------|-----------|---------|
| signal-1005 | 20 | 20 | 6 |
| signal-981 | 17 | 17 | 146 |
| signal-641 | 16 | 21 | 25 |
| signal-56 (Calea Aradului) | 14 | 16 | 522 |
| signal-141 | 14 | 20 | 94 |
| signal-1090 | 12 | 20 | 1,670 |
| signal-489 | 10 | 18 | 1,985 |

**Key finding: rush vs off-peak is nearly identical.** E.g., signal-56: 15 vehicles median at rush hour vs 14 off-peak. Consistent with 83% saturation — the network is near-capacity all day.

Output: `data/derived/queue-estimates.json`

---

## Queue-to-Capacity Ratio (QCR) Analysis

QCR converts observed queue lengths into demand estimates:

```
QCR = (queue × 3600 / red_seconds) / (1800 × lanes)
QCR > 1.0 = queue grows each cycle (oversaturated)
QCR < 1.0 = queue clears during green (stable)
```

**City-wide QCR distribution (462 signals with ≥ 50 samples):**

| Level | QCR Range | Signals | % |
|-------|-----------|---------|---|
| OVERSATURATED | ≥ 1.0 | 0 | 0% |
| HEAVY | 0.75–1.0 | 0 | 0% |
| LIGHT | 0.50–0.75 | 2 | 0% |
| FREE | < 0.50 | 460 | 100% |

**Most stressed approaches:**

| Signal | Median Queue | QCR | QSI | Cycle | Green% | Red s |
|--------|-------------|-----|-----|-------|--------|-------|
| signal-981 | 17 | 0.50 | 65% | 42s | 19% | 34 |
| signal-56 | 14 | 0.70 | 54% | 147s | 86% | 20 |

**The critical interpretation:** 0 signals are oversaturated. This does NOT mean the city is uncongested — it means the **adaptive signal system (SWARCO/UTOPIA/SCOOT) actively prevents individual intersections from going oversaturated**. It adjusts green time to prevent collapse, but this keeps city-wide average speed depressed (19.4 km/h). The system's job is collapse prevention, not flow optimization. V1 route at 8.8 km/h is the clearest evidence of this pervasive slowdown.

Output: `node scripts/qcr-analysis.mjs`

---

## Data Sources

| Source | Description |
|--------|-------------|
| **STPT** | Live bus GPS — `data/stpt2.db` (261MB, ~500k+ rows, 192 vehicles, 57 routes) |
| **TomTom Traffic Flow** | Per-segment speed ratios — `data/traffic-flow/` |
| **Timișoara Open Data** | Signal locations, road closures — municipal API |
| **OSM Overpass** | Road geometry |

---

## Key Output Files

| File | Description |
|------|-------------|
| `data/derived/calibration-results.json` | Per-route IDM/Newell/Gipps parameters |
| `data/derived/congestion-regimes.json` | Kerner regimes + TTI/BI indices |
| `data/derived/arrival-model.json` | Per-signal speed ratio distributions by time slot |
| `data/derived/queue-estimates.json` | GPS-derived queue estimates for 995 signals |
| `data/uxsim/ground-truth-real.json` | Real corridor delays from STPT + TomTom |
| `data/traffic-lights/signals.json` | 1,131 inferred signal locations + programs |

---

## Adaptive Signal System — The Key Insight

Timișoara's controllers (SWARCO/UTOPIA/SCOOT) continuously adjust green time to prevent queue blow-up. **They do not optimize flow** — they prevent collapse. This explains:
- 0 oversaturated signals (QCR < 1.0 for all 462 measured)
- 83% of signal approaches in heavy/blocked regime (network is always near-capacity)
- City-wide avg speed of 19.4 km/h (depressed but stable)
- V1 route at 8.8 km/h (extreme bottleneck, not quite gridlock)

The adaptive system keeps the city teetering just below collapse, not flowing well.

---

## UXsim Validation Results

Real ground truth (STPT + TomTom consensus):

| Scenario | Corridor | Real GT Delay |
|----------|----------|--------------|
| TM-01 | Bulevardul Republicii | 23.8s |
| TM-02 | Calea Aradului | 25.7s |
| TM-03 | Calea Șagului | 14.5s |
| TM-04 | Circumvalațiunii | 20.1s |

Static UXsim vs real GT:
- TM-01: 20.3s vs 23.8s → **3.5s error** ✓
- TM-02: 17.3s vs 25.7s → 8.4s error ✗
- TM-03: 24.9s vs 14.5s → 10.4s error ✗
- TM-04: 17.9s vs 20.1s → **2.2s error** ✓

TM-02 and TM-03 fail because demand calibration uses a single-signal delay to represent entire corridor demand — the arrival model bottleneck (origin signal) doesn't capture distributed queue buildup along multi-signal corridors.

TACTICS-adaptive UXsim produces virtually identical results to static UXsim — the fuzzy adaptation logic runs but demand mismatch dominates. The remaining gap is in demand calibration, not signal timing.

---

## Common Agent Questions

**Q: How congested is Timișoara?**
A: Extremely. 83% of signal approaches are in heavy/blocked Kerner regime. City-wide avg speed is 19.4 km/h vs 50 km/h free-flow. TTI = 0.63 (travel takes 63% longer than it should). V1 route is effectively blocked at 8.8 km/h. But no single intersection goes oversaturated (QCR < 1.0 everywhere) — the adaptive system prevents that.

**Q: Can we measure queue length from GPS data?**
A: Yes. When a bus is stopped within 180m of a signal, the distance from the bus to the stop line divided by jam-density gap (~7.6m/vehicle at rest) gives vehicles ahead. Median queues up to 20 vehicles observed at the most congested signals.

**Q: Why is QCR 0 for oversaturated signals if the city is 83% congested?**
A: QCR measures whether a queue grows cycle-to-cycle at a specific signal. The adaptive controllers prevent this — they extend green before queues grow unbounded. The 83% congestion figure measures speed reduction, not queue blow-up. The city is always slow but rarely collapses.

**Q: What does the car-following calibration tell us?**
A: Buses in Timișoara follow with ~15.7s time gap (very cautious — for safety during boarding). Queue discharge wave speed is 12 km/h everywhere. All 8 high-quality routes cluster at the same parameters — driving behavior is city-wide uniform.

**Q: What are the main unsolved problems?**
A: (1) Demand calibration doesn't generalize across corridor topologies — single-signal delay doesn't represent multi-signal corridor demand. (2) The 10m signal filter still doesn't distinguish same-road vs opposite-carriageway signals. (3) The adaptive system's algorithm type (SWARCO/UTOPIA/SCOOT) can't be confirmed without direct controller access.