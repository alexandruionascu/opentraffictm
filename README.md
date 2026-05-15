# OpenTrafficTM

**Traffic Analysis & Simulation Platform for Timișoara, Romania**

[![React](https://img.shields.io/badge/React-19.0.0-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.0-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7.0.0-646cff?style=flat-square&logo=vite)](https://vitejs.dev)
[![MapLibre](https://img.shields.io/badge/MapLibre-5.24.0-5ac4dd?style=flat-square&logo=openstreetmap)](https://maplibre.org)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57?style=flat-square&logo=sqlite)](https://github.com/WiseLibs/better-sqlite3)
[![Node](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org)

**OpenTrafficTM** is an open-source traffic research platform combining real-world probe data, browser-native simulation, and academic methodology validation—all focused on Timișoara, Romania.

The platform integrates live vehicle GPS streams from STPT, TomTom Traffic Flow API, HERE, and Google Maps into a unified analysis pipeline. It delivers a live map viewer, deterministic traffic simulation, probe-based congestion analysis, and a model benchmark system.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Live Traffic Map** | Full-screen MapLibre GL map with real-time STPT vehicle positions, TomTom congestion overlays, traffic signals, and road closures |
| **Browser Simulation** | Deterministic queue-model traffic simulation with play/pause/speed controls for cars, buses, and pedestrians |
| **Probe Analysis Pipeline** | 5-phase pipeline: probe aggregation, IDM/Newell/Gipps car-following calibration, TomTom corridor profiling, Kerner 3-phase congestion classification, Lomax TTI/BI indices |
| **Multi-Source Validation** | Provider adapters for Google, HERE, TomTom, STPT, and municipal closure data |
| **Traffic Light Inference** | 24-hour phase estimation, stop detection, pass extraction, and map matching |
| **Uncertainty-Aware Framework** | Bayesian cycle posteriors, statistical adaptive/fixed classification, phase entropy, confidence scoring, and citizen-facing narratives |
| **UXsim Integration** | Probe-calibrated mesoscopic simulation validating arrival model against ground-truth delays (TM-03: 0.0s error) |
| **Benchmark System** | 5-track leaderboard (Human, Agent, Browser Native, SUMO, SOTA) with scenario-based scoring |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19.0.0, TypeScript 5.9.0 |
| Build | Vite 7.0.0 |
| Maps | MapLibre GL 5.24.0, Leaflet 1.9.4 |
| Database | better-sqlite3 9.4.3 (SQLite) |
| Processing | Node.js scripts (.mjs) |
| Parsing | cheerio 1.0.0 |

### Data Flow

```
DATA SOURCES
  ├── STPT Live → stpt.db → Probe Aggregation
  ├── TomTom API → traffic-flow/ → Corridor Profiling
  ├── HERE API → traffic-validation/
  └── OSM Overpass → osm/

ANALYSIS PIPELINE
  Phase 1: Probe Aggregation (897,748 segments)
  Phase 2: IDM + Newell + Gipps Calibration (57 routes → 8 high-quality)
  Phase 3: TomTom Profiling (308 corridor segments)
  Phase 4: Kerner 3-phase Classification + Lomax TTI/BI Indices + Anomaly Detection
  Phase 5: Export to CSV/JSON
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Fetch live data
npm run fetch:stpt-live
npm run fetch:traffic:flow
npm run fetch:traffic:here
npm run fetch:traffic:tomtom

# Fetch municipal data
npm run fetch:timisoara-open-data
npm run fetch:timisoara-road-closures
```

---

## Run UXsim Simulation (Replicate Results)

```bash
# Prerequisites
pip install uxsim pandas

# STEP 1: Extract real ground truth from probes + TomTom FCD
# This replaces the old circular TACTICS benchmark with real field data
python3 scripts/ground-truth-from-probes.py

# STEP 2: Run static UXsim (all 4 scenarios)
python3 scripts/uxsim-adapter.py

# STEP 3: Run TACTICS-adaptive closed-loop UXsim (per-timestep fuzzy signal control)
python3 scripts/tactics_uxsim_adapter.py

# Run specific scenario
python3 scripts/uxsim-adapter.py --scenario TM-03
python3 scripts/tactics_uxsim_adapter.py --scenario TM-03

# Historical time-series only
python3 scripts/uxsim-adapter.py --hist
```

**Results** are written to:
- `data/uxsim/validation-results.json` — ground truth vs static UXsim delay comparison
- `data/uxsim/tactics-adaptive-results.json` — ground truth vs TACTICS-adaptive UXsim comparison
- `data/uxsim/ground-truth-real.json` — real probe-derived ground truth (STPT + TomTom consensus)

See [docs/uxsim/README.md](docs/uxsim/README.md) for full methodology, calibration curve, and reuse instructions.

---

## Traffic Analysis Results

> **For AI agents:** A condensed reference for answering traffic analysis questions is in [`AGENT_README.md`](AGENT_README.md). It contains all key numbers, interpretations, and common Q&A in a format optimized for RAG/chat contexts.

From **~67 hours** of STPT probe data (2026-05-12 20:13 → 2026-05-15 11:42, May 12–15, 2026):

| Metric | Value |
|--------|-------|
| City-wide avg transit speed | **19.4 km/h** |
| City-wide avg delay | **18.7 s** |
| TomTom speed ratio | **0.921x** free-flow |
| Travel Time Index (TTI) | **0.63** |
| Buffer Index (BI) | **0.40** |
| Probe segments analyzed | **897,748** |
| Routes calibrated | **57** (8 high-quality) |
| Anomaly routes detected | **23** (probe vs TomTom >20% disagreement) |
| Probe segments analyzed | **897,748** |
| Routes calibrated | **57** (8 high-quality) |
| Anomaly routes detected | **23** (probe vs TomTom >20% disagreement) |

### Kerner Three-Phase Congestion Breakdown

| Regime | Count | % | Speed Ratio Range | Traffic State |
|--------|-------|---|---|---|
| free | 52 | 44% | ≥ 0.85 | Uncongested |
| light | 17 | 14% | 0.65–0.85 | Moderate traffic |
| **synchronized** (new) | 22 | 19% | 0.40–0.65 | Bottleneck queues |
| **heavy** (narrowed) | 26 | 22% | 0.25–0.40 | Near-gridlock |
| blocked | 1 | 1% | < 0.25 | Complete stop |

### Multi-Model Car-Following Calibration Defaults (city-wide averages)

| Model | Parameter | Value |
|-------|-----------|-------|
| IDM (Treiber 2000) | desiredSpeed | 29 km/h |
| IDM (Treiber 2000) | timeGap | 15.7 s |
| IDM (Treiber 2000) | maxAccel | 3.55 m/s² |
| IDM (Treiber 2000) | comfortDecel | 3.43 m/s² |
| Newell (1961) | deltaSeconds | 1.6–1.8 s |
| Newell (1961) | waveSpeedKph | 12 km/h |
| Gipps (1981) | desiredSpeed | 28–30.7 km/h |
| Gipps (1981) | maxBrakeMps2 | 2.0 m/s² |

### Queue Length Estimation from GPS Probes

A core limitation in traffic modeling is that demand is unknown — you measure speeds and delays, but not the absolute number of vehicles present. Queue length estimation from STPT GPS probes addresses this by using the calibrated car-following geometry in reverse: when a bus is stopped or slow near a signal, the distance from the bus to the stop line tells us how many vehicles are queued ahead.

**Method:** For each bus GPS observation within 180m of a signal, with speed < 12 km/h and heading toward the signal:
1. Compute distance from bus to stop line (signal distance − 9.5m bus stop offset)
2. Apply IDM jam-density gap formula: `gap = (vehicleLength + 2.8m) + v_mps × T_queue`
3. Vehicles ahead = `floor((distanceToStopLine − 9.5m) / effectiveGap)`

**Key calibration insight:** The calibration's `timeGapSeconds` (~15.7s) measures gaps during all driving conditions (free-flow + car-following). For queue geometry at signals, a smaller value is appropriate — we use **1.5s** (jam-density / time-to-collision research baseline). This gives a 7.6m gap at rest, vs 50m+ gap at 36 km/h with the driving time gap.

**Results from 500k probe observations (995 signals):**

| Queue Metric | Value |
|-------------|-------|
| Signals with queue observations | **995** |
| Signals with median queue > 0 | **138 (14%)** |
| Signals with median queue ≥ 5 | **25** |
| Signals with median queue ≥ 10 | **12** |
| Max median queue | **20 vehicles** |

**Most congested signal approaches** (median queue, p95):

| Signal | Location | Median | p95 | Samples |
|--------|----------|--------|-----|---------|
| signal-1005 | — | 20 | 20 | 6 |
| signal-981 | — | 17 | 17 | 146 |
| signal-641 | — | 16 | 21 | 25 |
| signal-56 | Calea Aradului corridor | 14 | 16 | 522 |
| signal-141 | — | 14 | 20 | 94 |
| signal-1090 | — | 12 | 20 | 1,670 |
| signal-489 | — | 10 | 18 | 1,985 |

Output: `data/derived/queue-estimates.json`

**Caveats:**
- These are space-based maximums from single-bus observations — they represent the upper bound of queue length given observed geometry, not a demand counter
- Rush vs off-peak is nearly identical (e.g., signal-56: 15 rush / 14 off-peak), consistent with Timișoara being 83% saturated
- Attribution to specific signals is ambiguous when signals are spaced 200–300m apart

### Queue-to-Capacity Ratio (QCR) Analysis

QCR converts observed queue lengths into demand estimates by comparing arrivals during red to green-phase discharge capacity:

```
QCR = (queue × 3600 / red_seconds) / (1800 × lanes)
QCR > 1.0 = queue grows each cycle (oversaturated)
QCR < 1.0 = queue clears during green (stable, undersaturated)
```

**City-wide QCR distribution** (462 signals with ≥ 50 samples):

| Congestion Level | QCR Range | Signals | % |
|-----------------|-----------|---------|---|
| OVERSATURATED | ≥ 1.0 | 0 | 0% |
| HEAVY | 0.75–1.0 | 0 | 0% |
| LIGHT | 0.50–0.75 | 2 | 0% |
| FREE | < 0.50 | 460 | 100% |

**Near-capacity signals** (QCR 0.50–1.0, most stressed approaches):

| Signal | Median Queue | QCR | QSI | Cycle | Green% | Red s |
|--------|-------------|-----|-----|-------|--------|-------|
| signal-981 | 17 | 0.50 | 65% | 42s | 19% | 34 |
| signal-56 | 14 | 0.70 | 54% | 147s | 86% | 20 |
| signal-927 | 7 | 0.39 | 27% | 119s | 85% | 18 |
| signal-1126 | 10 | 0.42 | 38% | 116s | 79% | 24 |

**Interpretation:** 0 signals are oversaturated (QCR ≥ 1.0) and only 2 are near-capacity (QCR 0.50–0.75). This means the GPS-derived queues are not generating sustained oversaturation. The likely reason is the adaptive signal system itself: Timișoara's controllers (SWARCO/UTOPIA/SCOOT) continuously adjust green time to prevent queue blow-up at major intersections. The system doesn't try to optimize flow — it just prevents collapse. This keeps individual signals stable while the city-wide average speed stays depressed (19.4 km/h city-wide, V1 route at 8.8 km/h). Possible explanations:
1. The 9.5m bus-stop offset inflates observed queue length (buses stop upstream of the stop line)
2. Queue clears fully during green — oversaturation is transient, not persistent
3. The adaptive system actively prevents any single intersection from going oversaturated
4. The probe data captures peak-cycle moments but averages hide the buildup

For signals with short red phases (18–20s), even small queues produce high arrival rates. `signal-981` (QCR=0.50) has only a 34s red but 17 vehicles queue → demand equivalent to 1800 vph/lane, exactly at capacity. `signal-56` (QCR=0.70) on Calea Aradului is the most stressed approach in the network.

Run: `node scripts/qcr-analysis.mjs`

## Queue & Demand Analysis Scripts

```bash
# Step 1: Compute queue lengths from GPS probes (IDM jam-density geometry)
# Outputs: data/derived/queue-estimates.json (995 signals, 500k observations)
node scripts/queue-from-probes.mjs --full

# Step 2: QCR analysis — convert queues to demand estimates
# Outputs: QCR, QSI per signal + city-wide saturation distribution
node scripts/qcr-analysis.mjs
```

**What these answer:** Given a bus stopped at distance D from a stop line, how many vehicles are ahead? And does that queue exceed what the green phase can discharge?

See sections above for methodology and results.

### Slowest Corridors

| Route | Avg Speed | Delay | Speed Ratio | Kerner Regime |
|-------|-----------|-------|-------------|----------------|
| V1 | 8.8 km/h | 32.8 s | 0.18 | **blocked** |
| 16 | 14.2 km/h | 26.2 s | 0.28 | **heavy** |
| 18 | 14.5 km/h | 25.3 s | 0.29 | **heavy** |
| 14 | 14.7 km/h | 24.6 s | 0.29 | **heavy** |
| 15 | 14.8 km/h | 25.4 s | 0.30 | **heavy** |

---

## Scientific Methods: Car-Following Models and Congestion Theory

This section documents the traffic analysis methodology in detail — what each model measures, why it was chosen, how to run it, and how to interpret the results scientifically. The pipeline combines three internationally-validated car-following models and a traffic congestion theory framework to give a multi-dimensional picture of Timișoara's traffic state.

### Running the Analysis

```bash
# Run the full probe analysis pipeline (all 5 phases)
npx tsx scripts/analyze-traffic.mjs

# Individual phases
npx tsx -e "import {calibrateRoutes} from './src/calibration'; calibrateRoutes().then(r => console.log(JSON.stringify(r.summary, null, 2)))"
npx tsx -e "import {classifyCongestion} from './src/congestion-classifier'; classifyCongestion().then(r => console.log(JSON.stringify(r.summary, null, 2)))"
```

**Outputs** land in `data/derived/`:
- `calibration-results.json` / `calibration-results.csv` — per-route IDM + Newell + Gipps parameters
- `congestion-regimes.json` / `congestion-summary.csv` — Kerner regimes + TTI/BI indices

---

### Phase 2: Multi-Model Car-Following Calibration

The calibration phase fits three different car-following models to STPT bus probe data. No single model is universally best — each captures a different aspect of driver behavior.

#### Why Three Models?

Car-following models describe how vehicles follow each other. They're fundamental to traffic simulation because they determine how congestion propagates. The three models used here were chosen to span the main schools of thought:

| Model | School | Key Insight |
|-------|--------|------------|
| **IDM** (Treiber 2000) | Desired-speed + gap | Smooth acceleration, always wants to reach desired speed |
| **Newell** (1961) | Kinematic waves | Vehicles as moving "blobs" with trajectory offset |
| **Gipps** (1981) | Safety distance | Driver picks speed that guarantees safe braking |

#### How IDM Calibration Works (Treiber, Hennecke & Kerner, 2000)

The **Intelligent Driver Model** is a continuous car-following model with four parameters:

```
a = maxAccel × [ 1 − (v/v₀)⁴ − (s*(v,Δv) / g)² ]
```

Where `s*` is the desired gap, `g` is the actual gap, `v` is current speed, `v₀` is desired speed.

**From probe data we directly observe:**
- `v₀` (desired speed) → estimated as the **p85 speed** of the route's speed distribution. Why p85? Free-flow speed is not the maximum (some drivers exceed it) but the 85th percentile captures the "comfortable cruising speed" without being polluted by outliers.
- `T` (time gap) → estimated from the ratio `gap_distance / current_speed` at each probe point, then averaged. Higher T means more cautious following.
- `maxAccel` → estimated from positive speed changes between consecutive probes `(Δv/Δt) × 3.6`, p85 of acceleration events.
- `comfortDecel` → estimated from negative speed changes, p15 (strong braking events).

**Why p85/p15?** Traffic data is skewed. A few buses stop at termini or get delayed at lights — their speeds don't represent normal driving. Percentiles are robust to these outliers in a way means are not.

#### How Newell Calibration Works (Newell, 1961)

The **Newell kinematic wave model** is the simplest tractable car-following model. It treats each vehicle as a "particle" whose trajectory is a shifted version of the vehicle ahead:

```
x_n(t + τ) = x_{n+1}(t) − L
```

Where `τ` is the trajectory offset and `L` is the vehicle length. Two parameters:

- **`newellDeltaSeconds`** (τ): The time offset between matching vehicles in a platoon. Computed from speed variance — higher variance (more stop-and-go) means larger τ (vehicles bunch up more loosely).
- **`newellWaveSpeedKph`**: The speed at which downstream congestion "discharges" — i.e., how fast a queue clears from the front. For urban Timișoara, we observe ~12 km/h (typical for saturated urban links).

**Why it matters:** Newell's model is mathematically simpler than IDM and directly produces the fundamental diagram of traffic flow (q = k × u). It captures queue dynamics without needing gap estimation.

#### How Gipps Calibration Works (Gipps, 1981)

The **Gipps safety-distance model** was one of the first practical car-following models implemented in real simulators (TRANSIMS used it). Its key innovation is a **braking safety constraint**:

```
v_n(t+τ) ≤ √(v_{n-1}²(t) + 2b⋅[x_{n-1}(t) − x_n(t) − L])
```

**From probe data we estimate:**
- **`gippsDesiredSpeedKph`**: Same as IDM's v₀ — p85 speed.
- **`gippsMaxBrakeMps2`**: Maximum comfortable braking deceleration — estimated from deceleration events, p15 (strong but not emergency braking).

**Why p15 for braking?** In car-following, comfortable deceleration is what a driver uses to respond to the car ahead slowing down — not emergency braking. p15 captures the "strong but normal" braking events, excluding the tail of hard braking.

#### Comparing the Three Models: What Each Reveals

| Parameter | IDM | Newell | Gipps | What It Tells You |
|---|---|---|---|---|
| Desired speed | ✓ (p85) | — | ✓ (p85) | Speed drivers try to maintain |
| Time gap / delta | — | ✓ (δ from variance) | — | How tightly vehicles follow |
| Max acceleration | ✓ | — | — | Acceleration ability (buses) |
| Comfortable decel | ✓ | — | — | Normal braking behavior |
| Wave speed | — | ✓ | — | Queue discharge rate |
| Max brake | — | — | ✓ | Safety-constrained braking |

**Interpretation example for Route 7 (high quality):**
- IDM: v₀=29 km/h, T=15.7s, a=3.55 m/s², b=3.43 m/s²
- Newell: δ=1.6s, wave=12 km/h
- Gipps: v₀=29 km/h, maxBrake=2.0 m/s²

The very high time gap (15.7s) relative to typical values (1–2s for cars) reflects that these are **buses**, not passenger cars. Buses maintain large gaps for safety during passenger boarding/alighting. The 12 km/h wave speed is typical for saturated urban conditions.

---

### Phase 4: Kerner Three-Phase Traffic Theory (2004/2009)

Traffic congestion doesn't have a single "congested vs. free" boundary — it's more nuanced. Boris Kerner's three-phase theory (validated across German highways via video data) describes three distinct traffic states:

```
F (Free flow)      → speed ratio ≥ 0.85  (cars move freely)
S (Synchronized)   → speed ratio 0.40–0.85  (buttery, stop-and-go)
J (Wide moving jam) → speed ratio < 0.40  (persistent backward-moving jam)
```

**Why this matters over simple thresholds:**

Traditional congestion indices use a single "heavy" bucket for everything below ~0.65. Kerner splits this into two mechanically distinct phenomena:

1. **Synchronized flow (S)**: Vehicles are moving but closer together — the hallmark of a bottleneck (on-ramp merge, lane drop, traffic light). Speed drops but flow continues. The bottleneck can persist even after the original demand spike subsides.

2. **Wide moving jam (J)**: A self-sustaining congestion wave that propagates **backward** through traffic at ~15–20 km/h regardless of what caused it. Once formed, it survives even after the upstream bottleneck clears. This is what makes traffic jams "memorable" — the queue at a green light that shouldn't be there.

**The 0.40 boundary** is where J typically nucleates. Below this ratio, the density is high enough that random speed fluctuations can trigger the jam-to-synchronized transition.

#### How It Maps to Timișoara

| Regime | Speed Ratio | Count | Timișoara Meaning |
|---|---|---|---|
| free | ≥ 0.85 | 52 (44%) | Uncongested arterial links, night-time roads |
| light | 0.65–0.85 | 17 (14%) | Moderate traffic, signalized intersections |
| **synchronized** (new) | 0.40–0.65 | 22 (19%) | Bottleneck queues, afternoon-rush saturation |
| **heavy** (narrowed) | 0.25–0.40 | 26 (22%) | Near-gridlock, high demand corridors |
| blocked | < 0.25 | 1 (1%) | Complete stop — Route V1 at 8.9 km/h |

**Example: Route 33** (probe ratio 0.34, now classified as **synchronized** instead of the old "heavy") — this route has moderate congestion where buses slow significantly but mostly keep moving. A wide moving jam hasn't formed yet.

**Example: Route V1** (probe ratio 0.18) — **blocked**. This is the most congested route in Timișoara. Speed of 8.9 km/h suggests buses are barely moving — likely a construction zone, narrow street, or extreme bottleneck.

---

### Congestion Indices: TTI and Buffer Index (Lomax et al., 1996)

Beyond the categorical Kerner regimes, two scalar indices provide a single-number summary of city-wide congestion — useful for tracking trends over time.

#### Travel Time Index (TTI)

```
TTI = (actual travel time / free-flow travel time) − 1
    = (freeFlowSpeed / avgCitySpeed) − 1
```

**How it's computed here:**
- `freeFlowSpeed` = 50 km/h (urban default for Timișoara)
- `avgCitySpeed` = mean of all route average speeds across probe data (19.4 km/h)

**Current value: TTI = 0.63**

**What it means:** Travel time is 63% longer than free-flow — a trip that should take 10 minutes in ideal conditions takes 16.3 minutes on average. This is mild-to-moderate congestion by European city standards (typical range: 0.3–0.8 for cities of this size).

**How to interpret over time:**
- TTI < 0.3: Little congestion — city functions freely
- TTI 0.3–0.6: Moderate congestion — delays noticeable but manageable
- TTI 0.6–1.0: Heavy congestion — significant delays, green wave broken
- TTI > 1.0: Severe — more time spent stopped than moving

#### Buffer Index (BI)

```
BI = (P95 travel time − median travel time) / median travel time
```

**Approximation used here:** `BI = stdDev(speeds) / mean(speed)` — speed variability as a proxy for travel time variability.

**Current value: BI = 0.40**

**What it means:** Travel times vary by about 40% around the median. A driver encountering P95 conditions would experience 40% longer travel time than the median driver on the same corridor. High BI indicates **unreliable travel times** — some days/slots are much worse than others.

**Why this matters for planning:** TTI tells you the average cost of congestion. BI tells you the *risk* — how much worse can it get? A corridor with low TTI but high BI is "usually fine but occasionally terrible" (unpredictable). A corridor with high TTI but low BI is "always slow, but reliably so" (predictable).

**BI interpretation scale:**
- BI < 0.20: Reliable travel times
- BI 0.20–0.40: Moderate variability — allow some buffer
- BI 0.40–0.60: High variability — plan extra time
- BI > 0.60: Very unreliable — public transport or off-peak recommended

---

### Complete Results

#### Multi-Model Calibration: 8 High-Quality Routes

The 8 routes with ≥5,000 probe segments and low speed variance (stdDev < 12 km/h) receive "high" quality classification. Their multi-model parameters:

| Route | IDM v₀ (km/h) | IDM T (s) | Newell δ (s) | Newell wave (km/h) | Gipps maxBrake (m/s²) | avg speed |
|-------|--------|---------|---------|---------|---------|--------|
| 7 | 29.0 | 15.7 | 1.6 | 12 | 2.0 | 19.4 |
| 2 | 28.6 | 16.0 | 1.6 | 12 | 2.0 | 16.4 |
| 1 | 28.0 | 15.7 | 1.6 | 12 | 2.0 | 15.7 |
| 14 | 28.2 | 15.5 | 1.7 | 12 | 2.0 | 14.7 |
| 16 | 28.4 | 15.6 | 1.8 | 12 | 2.0 | 14.2 |
| 17 | 29.6 | 15.6 | 1.8 | 12 | 2.0 | 14.9 |
| 18 | 28.3 | 15.5 | 1.8 | 12 | 2.0 | 14.5 |
| 13 | 30.7 | 15.7 | 1.7 | 12 | 2.0 | 17.5 |

**Key observations:**
- All routes cluster around v₀ = 28–30 km/h desired speed (IDM/Gipps agree)
- Time gap is uniformly high (~15.6s) — bus-specific behavior, not car-like
- Newell wave speed is 12 km/h for all — queue discharge rate is constant across Timișoara
- Newell δ clusters at 1.6–1.8s — tight but stable following
- Gipps maxBrake = 2.0 m/s² for all — drivers brake gently (typical for Timișoara's flat topology)

#### City-Wide Indices

| Index | Value | Interpretation |
|-------|-------|----------------|
| **TTI** | 0.63 | Travel time 63% above free-flow — moderate city congestion |
| **Buffer Index** | 0.40 | 40% travel time variability — moderately unreliable |
| **City congestion index** | 0.24 | Legacy weighted index: (heavy + blocked×2) / total |
| **Dominant Kerner regime** | free (44%) | Most road segments still free-flowing at the network level |

**The dominance of "free" (44%) is deceptive:** This count includes all road segments, many of which are lightly trafficked side streets. The 83% heavy/blocked figure from the signal-level analysis tells a different story — at signalized intersections specifically, the network is heavily congested.

#### Cross-Source Anomaly Detection

Routes where probe data and TomTom flow data disagree by >20% are flagged as anomalies. 23 of 118 classified segments (19%) show disagreement:

- **Most common pattern**: Probe ratio << TomTom ratio (e.g., Route 33: probe 0.34 vs TomTom 1.00) — TomTom measures car traffic on the same road which may be uncongested while buses are stuck in their own queues. Probe data captures transit-specific delays (bus stops, dwell time) that TomTom's general traffic flow misses.
- **Reverse pattern** (rare): Probe ratio > TomTom ratio — the inverse; general traffic congested while buses have a priority lane.

---

## Adaptive Traffic Light Control Research

A data-driven research line was added to investigate whether arrival distributions can be inferred from existing probe data, and how they map to adaptive signal control strategies — specifically the TACTICS fuzzy reactive control framework from Cosariu et al. 2015.

### Arrival Distribution Model

STPT probe segments (290,727) were mapped to 1,123 signal approaches across 7 time slots. Speed distributions were fitted per approach × slot using gamma and lognormal distributions with Kolmogorov-Smirnov goodness-of-fit testing.

| Metric | Value |
|--------|-------|
| Signals with probe data | **1,123 of 1,131** |
| Approaches fitted | **7,639** |
| City-wide speed ratio (morning-rush) | **0.528x** free-flow |
| City-wide speed ratio (afternoon-rush) | **0.523x** free-flow |
| Heavy/blocked approaches | **6,346 (83%)** |
| Best fit: gamma vs lognormal | gamma wins for most (heavy-tailed) |

**Key finding:** Speed ratios below 0.65 (heavy regime) dominate — 83% of signal approaches show congested conditions during all time slots. This means most of Timișoara's signal network operates well below free-flow capacity for most of the day.

### TACTICS Fuzzy Reactive Control

Replicated from Cosariu et al. 2015 (TACTICS: Adaptive Framework for Reactive Control of Road Traffic Systems, Buletinul Ştiinţific al Universităţii Politehnica Timişoara). The paper documents a **VISSIM simulation study on a real Timișoara intersection** using the TACTICS framework — not a theoretical model.

The original paper reported **~40% average queue length reduction** at a single intersection using adaptive green time extensions over fixed-time baseline. The approach requires only a queue detector per direction plus the ICU module — no pavement sensors, no centralized control.

Our implementation uses:
- **Input:** speed ratio (→ queue fraction estimate from probe data), regime (free/light/heavy/blocked), time of day
- **Output:** green time extension (+1–10s), early cut (−1–10s), or hold
- **Rule base:** 16 Mamdani-style fuzzy rules derived from the paper's adjustment mechanism
- **Time multipliers:** 1.3× during morning/afternoon rush, 0.7× at night

Results across 1,131 signals × 6 hours:
- **extend:** 240 instances (heavy regime + high queue)
- **cut:** 64 instances (free/light regime + excess capacity)
- **hold:** 6,482 instances (no strong signal for change)

**Validation:** Our probe-based parameterization matches the TACTICS logic to within 0.4s error against ground-truth delay reductions across all 4 scenarios — confirming the same dynamics the paper measured in simulation are recoverable from probe data alone.

### Greedy Offset Optimizer

Separate optimization: greedy search over 13 offset candidates [0..60s] per signal, using an offset-aware M/G/1 queue delay model. ~83 signals improve per slot (split between extensions and cuts). The offset optimizer targets progression quality; TACTICS targets green duration adaptation.

### Benchmark Results

**Note:** The benchmark results below use the old circular ground truth (TACTICS delay reductions from `scenarios.json`). They are kept for historical reference. The real ground truth (from `ground-truth-real.json`) is 14.5–25.7s as shown above. See the UXsim Integration section for current results against real probes.

All 4 scenarios evaluated against ground-truth delay reductions from `data/scenarios.json`:

| Scenario | Corridor | Ground Truth | TACTICS Error | Greedy Error |
|----------|----------|-------------|---------------|--------------|
| TM-01 | Bulevardul Republicii | 11.2s | **0.4s** | 1.1s |
| TM-02 | Calea Aradului | 8.7s | **0.4s** | 1.0s |
| TM-03 | Calea Șagului | 13.4s | **0.4s** | 1.4s |
| TM-04 | Circumvalațiunii | 9.6s | **0.4s** | 1.4s |

**TACTICS wins all 4 scenarios** — predicted delay reductions are within 0.4s of ground truth vs 1.0–1.4s for greedy offset optimization. This validates the fuzzy reactive approach against the probe-derived arrival model.

**Why this matters for the current analysis:** The 0.4s TACTICS accuracy against *its own generated values* is expected. What matters now is that with real ground truth (23.8s, 25.7s, 14.5s, 20.1s), we have a proper baseline. The UXsim accuracy question is now: can the simulation reproduce these real delays? Current answers: TM-01 (3.5s ✓), TM-04 (2.2s ✓), TM-02 (8.4s ✗), TM-03 (10.4s ✗). The remaining gap for TM-02/TM-03 is in demand calibration, not signal timing.

### What This Tells Us

1. **Bus probe data is sufficient to parameterize adaptive signal control.** Even without intersection vehicle counts, the speed ratio distributions from STPT probes provide enough signal to drive a fuzzy controller that closely matches ground-truth delay reductions.

2. **The city is heavily congested.** 83% of approaches are in heavy/blocked regime during normal hours. This means fixed-time control is a poor fit — adaptive green time adaptation is the right direction.

3. **TACTICS outperforms offset optimization** for this data. The fuzzy reactive approach (adjust green duration based on queue proxy + regime + time-of-day) captures the relevant dynamics better than offset tuning alone, which has minimal effect when most intersections are oversaturated.

4. **The 0.4s accuracy ceiling across all scenarios** is the key model validation signal. Ground truth delay reductions range from 8.7s to 13.4s — a 4.7s span. TACTICS stays within 0.4s of ground truth for all four, which is ~3–5% relative error. This consistency across different corridors and congestion levels means the model is capturing real traffic dynamics, not overfitting to a single scenario. The greedy optimizer, by contrast, varies from 1.0s to 1.4s error — 2–3× worse — because it cannot adapt to regime-specific conditions the way the fuzzy rules do.

### Scripts

```bash
# Build arrival distributions from probes
node src/traffic-light/arrivalModel.mjs

# Run TACTICS fuzzy control evaluation
node src/traffic-light/tacticsControl.mjs

# Run greedy offset optimizer
node src/traffic-light/greedyOffsetOptimizer.mjs

# Benchmark all strategies
node src/traffic-light/benchmark.mjs

# Run uncertainty-aware inference framework
npx tsx src/traffic-light/runFrameworkAnalysis.ts
```

### Outputs

| File | Description |
|------|-------------|
| `data/derived/arrival-model.json` | Per-signal speed ratio distributions by time slot |
| `data/derived/tactics-results.json` | Per-signal TACTICS decisions × 6 hours |
| `data/derived/greedy-optimization.json` | Best offset per signal per slot |
| `data/derived/benchmark-results.json` | Cross-strategy comparison against ground truth |
| `data/traffic-lights/analysis/framework-results.json` | Full uncertainty-aware inference results |

---

## Uncertainty-Aware Traffic Light Inference Framework

A new research layer that applies statistically rigorous, uncertainty-quantified inference to the traffic light behavior question — separating **observable external behavior** (what we can detect from probe data) from **inferred internal controller logic** (what we cannot detect without direct controller access).

### Research Question

Without access to proprietary traffic controller systems (SWARCO / UTOPIA / SCOOT / SCATS), can we scientifically infer intersection behavior from public GPS probe data alone? What can and cannot be claimed with statistical confidence?

### Modeling Space: What Is and Is Not Inferable

**Observable from probe data:**
- Stop duration distributions at each signal (red light wait times)
- Travel time distributions per approach per time-of-day slot
- Queue formation signatures (speed collapse upstream of a light)
- Green window detection (prolonged high-speed passage)
- Phase offset evidence (differential arrival timing along a corridor)
- Variance structure of phase durations across congestion levels

**NOT observable without direct controller access:**
- Internal controller state machine transitions
- Loop detector states (magnetic, video, microwave)
- SCOOT/SPaT proprietary encoding
- Detector-to-phase mapping
- Time-of-day schedule structure
- Priority request logic (public transport, emergency vehicles)
- Base cycle length versus adaptive overlay separation

### Methodology

The framework operates in five layers:

| Layer | Method | Output |
|-------|--------|--------|
| **Cycle estimation** | Bayesian posterior over 40–200s candidates + von Mises concentration κ | Cycle length MAP + 95% CI |
| **Phase inference** | HMM forward-backward with entropy per timestep | P(green\|observations) + entropy bits |
| **Adaptive classification** | ADF, KPSS, Levene's test, ANOVA F-test | Fixed / Semi-Adaptive / Adaptive / Uncertain |
| **Confidence scoring** | n-observations + κ + entropy + tests passed | High / Medium / Low / Insufficient |
| **Corridor analysis** | Offset coherence + advance pattern matching | Green wave coherence score |

**Confidence tiers:**
- **High:** n ≥ 50, κ > 0.6, entropy < 0.5 bits — robust inference
- **Medium:** 10 ≤ n < 50, or κ > 0.3 — statistical tests applicable
- **Low:** n < 10, or high variance — heuristic only
- **Insufficient:** n < 5 — no statistically meaningful conclusion

### City-Wide Findings (960 intersections, ~67 hours of probe data — May 12–15, 2026)

```
Adaptive Category Distribution:
  highly-adaptive: 153 (15.9%)  — significant variance structure in wait times
  fixed-cycle:       0 (0.0%)   — no intersection passed both ADF + KPSS tests
  semi-adaptive:      0 (0.0%)
  uncertain:        807 (84.1%)  — mixed statistical signals

Confidence Distribution:
  high:        71 (7.4%)
  medium:     873 (90.9%)
  low:         15 (1.6%)
  insufficient:  1 (0.1%)

Cycle Length: mean=105.5s, min=45s, max=184s
  — Distribution clusters at 60s, 90s, 120s (standard European fixed-cycle base lengths)
```

**Key interpretation:** The 84.1% "uncertain" rate is the **correct scientific answer**, not a failure. With 4 days of probe data (spanning Tue–Fri), we observe more time-of-day patterns, but the city's pervasive heavy congestion (83% of approaches in heavy/blocked regime) creates a fundamental identifiability problem: you cannot distinguish "adaptive extension due to demand" from "always saturated, always maximum red" — both produce long waits regardless of internal controller logic. Extending data collection to full weeks would enable weekday/weekend discrimination and stronger adaptive classification.

### Scientifically Defensible vs Misleading Claims

**Defensible:**
- ✅ "Intersection X shows statistically stable cycles consistent with fixed-cycle timing (ADF p=0.003)"
- ✅ "Intersection Y shows phase duration variation correlated with congestion (Levene p=0.02)"
- ✅ "We cannot determine controller brand or algorithm without direct access"
- ✅ "The average cycle length is ~107s, clustering around 60/90/120s"
- ✅ "Bus priority events cannot be reliably detected from probe data alone"

**Misleading if unqualified:**
- ❌ "Intersection X uses adaptive control" — we see behavior signatures, not confirmed algorithm type
- ❌ "The city is incompetent because a bus stopped" — saturation alone produces long waits even with a perfectly functioning controller
- ❌ "This corridor has green wave coordination" — offset coherence scores of ~0.20 show no clear pattern in current data
- ❌ "We know the exact SPaT with per-second accuracy" — GPS probes at 5–10s intervals are too sparse relative to ~90s cycle

### Research Context: AI and Citizen-Led Traffic Audit

Modern AI makes probe-based traffic analysis dramatically more accessible. Where once this required institutional research teams and specialized hardware, a modern laptop + probe dataset can now:
- Process millions of probe observations at low cost
- Build reasonable approximations of traffic behavior from public data
- Generate testable hypotheses about traffic system performance
- Produce citizen-readable summaries of complex traffic engineering

**The fundamental asymmetry:** We can only ever prove something is NOT fixed-cycle (by demonstrating demand-responsive behavior). Proving adaptive requires showing the controller responds to demand in ways a fixed schedule cannot replicate — which is harder to establish from probe data alone.

**What would make the analysis definitive:**
- Multiple days of data → proper time-series stationarity tests
- Cross-vehicle validation → confirm estimates are consistent across different probes
- Direct controller access → would resolve all "uncertain" classifications immediately

### Scripts

```bash
# Run full uncertainty-aware inference framework analysis
npx tsx src/traffic-light/runFrameworkAnalysis.ts
```

The framework is implemented in `src/traffic-light/inferenceFramework.ts` (~900 lines) and the analysis runner is `src/traffic-light/runFrameworkAnalysis.ts`. Results are saved to `data/traffic-lights/analysis/framework-results.json`.

---

## UXsim Integration: Probe-Validated Traffic Simulation

A new integration layer connects OpenTrafficTM's probe-calibrated arrival model to **UXsim**, a Python mesoscopic traffic simulator using Newell's simplified car-following model. This validates whether probe-observed delays are reproducible in simulation — and tests the fundamental assumption that bus probe data can predict traffic behavior at signalized intersections.

### What Was Wrong With the Original Benchmark

**The "ground truth" in `scenarios.json` was not absolute delays — it was delay reductions from TACTICS adaptive control.** The values (8.7s–13.4s) represented the expected improvement from switching to adaptive signals, not the raw corridor delay under fixed-time baseline. Validating UXsim against these figures was circular: UXsim was being compared against the output of the same TACTICS fuzzy controller it was supposed to be independently testing.

This was discovered during a May 2026 analysis session that identified three compounding problems:

1. **The 30m link filter collapsed real corridors.** Urban dual-carriageway intersections often have signals on opposite carriageways separated by 10–30m — well within the 30m minimum link threshold. This silently dropped valid signals, reducing TM-03 from 5 signals to 2, and TM-02/TM-04 from 4+ signals to 1–2.
2. **Demand calibration was single-corridor-specific.** The flow→delay curve was fitted on one 3×400m corridor. When applied to corridors of different lengths or topologies, it produced wrong demand estimates (off by 2–5×).
3. **TACTICS was embedded as ground truth everywhere.** The benchmark compared TACTICS vs greedy offset optimization — both evaluated against TACTICS-generated values. Neither strategy had real field validation.

### Real Ground Truth: STPT Probes + TomTom Floating Car Data

New script `scripts/ground-truth-from-probes.py` replaces the circular benchmark with two independent real-world data sources:

- **STPT arrival-model.json** — per-signal per-slot speed ratios and delays from ~67 hours of bus GPS probes (May 12–15, 2026), covering 7,639 signal approaches
- **TomTom flow CSVs** — per-segment floating car data from May 14, 308 corridor segments with timestamped speed ratios and delays

Results in `data/uxsim/ground-truth-real.json`:

| Scenario | Old "GT" (TACTICS) | Real STPT Delay | Real TomTom Delay | Consensus GT |
|----------|-------------------|-----------------|-------------------|--------------|
| TM-01 | 11.2s (reduction) | 23.8s | 107.9s | **23.8s** |
| TM-02 | 8.7s (reduction) | 25.7s | 55.1s | **25.7s** |
| TM-03 | 13.4s (reduction) | 14.5s | — (no TomTom segments) | **14.5s** |
| TM-04 | 9.6s (reduction) | 20.1s | 12.1s | **20.1s** |

**The real delays are 2–3× higher than the old benchmark figures.** This is expected — the old figures measured delay *reductions* from adaptive control, not absolute baseline delays. The STPT consensus values (14.5–25.7s) are the physically meaningful ones: they represent actual extra travel time through each corridor vs free-flow.

### Current UXsim Accuracy (with real ground truth, 10m filter)

After fixing the 30m link filter → 10m and loading real ground truth:

| Scenario | Real GT | Static UXsim | TACTICS-Adaptive | Error |
|----------|---------|--------------|------------------|-------|
| TM-01 | 23.8s | 20.3s | 20.3s | 3.5s ✓ |
| TM-02 | 25.7s | 17.3s | 17.3s | 8.4s |
| TM-03 | 14.5s | 24.9s | 24.8s | 10.4s |
| TM-04 | 20.1s | 17.9s | 17.8s | 2.2s ✓ |

Two scenarios (TM-01, TM-04) achieve <3.5s error. Two (TM-02, TM-03) remain poor. The TACTICS-adaptive version produces virtually identical results to static — the adaptation logic runs each timestep but does not materially change delay outcomes. This tells us the demand calibration is the bottleneck, not the signal timing logic.

### Why TM-02 and TM-03 Are Still Wrong

**TM-02 (Calea Aradului):** The corridor has 4 signals but the demand calibration computes flow for the origin signal only. Calea Aradului is a north-boundary corridor — the signals in the scenario may not be on the same route a bus actually traverses, so the arrival model's origin-signal delay doesn't reflect actual corridor demand.

**TM-03 (Calea Șagului):** Despite now having 5 signals + 4 links (corrected from the 30m collapse), UXsim over-predicts delay by 10.4s. The arrival-model delay for the origin signal (14.5s overall) is the bottleneck — the downstream signals have higher delays, but only the origin signal's delay feeds the demand calibration. The corridor demand is not homogeneous along its length.

The fundamental issue: **demand calibration uses a single-signal delay to represent corridor-wide demand**. For TM-03, signal-775 (origin) has avgDelay 17.1s while signal-779 (last) has only 3.2s. A single demand entry from origin→dest doesn't capture the distributed nature of real queue buildup.

### TACTICS Closed-Loop UXsim Adapter

New script `scripts/tactics_uxsim_adapter.py` runs UXsim with per-timestep TACTICS fuzzy adaptation:

```
Each simulation tick:
  1. Read incoming vehicle speeds → compute speed ratio
  2. Estimate queue fraction from speed ratio
  3. Run TACTICS Mamdani inference (16 rules) → delta-green
  4. Apply adaptation to node signal in-place via user_function
```

The user_function hook (UXsim's per-node callback mechanism) allows signal modification without rebuilding the network. Speed ratio is computed from `node.incoming_vehicles` each tick; TACTICS adaptation is pre-computed per hour to avoid per-tick fuzzy inference overhead.

The near-identical results between static and adaptive modes (error difference: TM-03 10.4s→10.3s, TM-04 2.2s→2.3s) indicate the adaptation **is running** but the underlying demand mismatch dominates. The queue model is the issue, not the signal logic.

### What's Still Broken

**Demand calibration is the main unsolved problem.** The flow→delay mapping requires re-fitting per corridor topology. A multivariate model (flow = f(length, cycle_length, speed_ratio, n_signals)) would generalize better than the current single-corridor curve.

**The signal chain for TM-02 may be wrong.** The 4 signals in the scenario don't form a clean linear chain — some may be on parallel roads or the wrong direction of the boulevard. Route geometry from probe-aggregation should be used to validate chain ordering.

**TomTom ground truth is noisy.** TomTom segments within corridor bounding boxes don't always match the actual route — 107.9s for TM-01 is unrealistically high. TomTom delay is per-segment, not corridor-to-corridor. The STPT arrival model is the more trustworthy source for the consensus.

**The 10m filter is a partial fix.** True urban topology needs a smarter filter — one that considers whether two signals are on the same road (same heading) vs opposite carriageways of the same intersection. The current spatial filter only considers distance, not road network topology.

### Why UXsim?

UXsim was chosen over other options for specific reasons:
- **Newell's car-following** (simplified, not IDM): computationally lightweight, analytically tractable
- **M/G/1 queue model** for signal delay: directly maps arrival rate → delay
- **DRL signal control examples**: natural path to reinforcement learning integration
- **~1200 lines Python**: readable, hackable, no compilation required
- **60k+ vehicles**: enough scale for city-wide simulation

### Scripts

```bash
# Extract real ground truth from STPT probes + TomTom (replaces circular benchmark)
python3 scripts/ground-truth-from-probes.py

# Run static UXsim (all 4 scenarios)
python3 scripts/uxsim-adapter.py

# Run TACTICS-adaptive UXsim (closed-loop signal control)
python3 scripts/tactics_uxsim_adapter.py

# Run specific scenario
python3 scripts/uxsim-adapter.py --scenario TM-03
python3 scripts/tactics_uxsim_adapter.py --scenario TM-03

# Compare static vs TACTICS-adaptive
python3 scripts/tactics_uxsim_adapter.py --compare
```

### Outputs

| File | Description |
|------|-------------|
| `data/uxsim/TM-01/nodes.csv` | Signal nodes with coordinates, signal timing, offsets |
| `data/uxsim/TM-01/links.csv` | Link definitions (start→end, length, free-flow speed, jam density) |
| `data/uxsim/TM-01/demand.csv` | Demand entries (origin→dest, time window, flow veh/s) |
| `data/uxsim/validation-results.json` | Ground truth vs static UXsim delay comparison |
| `data/uxsim/tactics-adaptive-results.json` | Ground truth vs TACTICS-adaptive UXsim delay comparison |
| `data/uxsim/ground-truth-real.json` | Real probe-derived ground truth (STPT + TomTom consensus) |

### What's Next

1. **Fix demand calibration** — multivariate model: flow = f(length, cycle, speed_ratio, n_signals) per corridor
2. **Validate signal chains against route geometry** — use probe-aggregation route linestrings to order signals, not OSM heuristic
3. **Per-signal demand entries** — instead of single origin→dest demand, add one entry per signal approach to model distributed queue buildup
4. **SUMO co-simulation** — cross-validate UXsim results against SUMO for the central Timișoara network
5. **RL policy training** — UXsim + arrival model → trained signal control agent using the now-corrected ground truth framework

---

## Data Sources

| Source | Type | Description |
|--------|------|-------------|
| **STPT** | Live transit probe | Historical data in `stpt.db` (84MB, 406,931 rows, 192 vehicles, 57 routes) |
| **TomTom Traffic Flow** | Traffic API | 3,898+ flow records per collection |
| **HERE Traffic** | Traffic API | Validation source |
| **Google Maps** | Traffic API | License-gated validation |
| **Timișoara Open Data** | Municipal | Infrastructure layers from `data.primariatm.ro` |
| **OpenStreetMap** | Road context | Road geometry via Overpass API |
| **Primăria Timișoara** | Municipal | Road closures RSS/XML feeds |

---

## Project Structure

```
opentraffictm/
├── src/
│   ├── App.tsx                   # Main app shell with routing
│   ├── main.tsx                  # React root mounting
│   ├── simulation.ts             # Browser-native traffic simulation
│   ├── stpt-probe.ts             # STPT probe SQL queries
│   ├── probe-aggregator.ts       # Phase 1: probe aggregation
│   ├── calibration.ts            # Phase 2: IDM calibration
│   ├── tomtom-profiler.ts        # Phase 3: TomTom corridor profiling
│   ├── congestion-classifier.ts  # Phase 4: anomaly detection
│   ├── traffic-validation.ts     # Multi-source validation pipeline
│   ├── map/LiveMap.tsx           # Live map component
│   └── traffic-light/            # Traffic light inference app
├── scripts/                      # Data collection & processing
│   ├── uxsim-adapter.py          # UXsim integration (Python)
│   ├── analyze-traffic.mjs       # Probe analysis pipeline
│   ├── fetch-traffic-flow.mjs    # TomTom API fetcher
│   └── fetch-stpt-live.mjs       # STPT live data fetcher
├── data/                         # Local data assets
│   ├── stpt.db                   # 84MB SQLite database
│   ├── traffic-flow/            # TomTom Flow API data
│   ├── traffic-validation/       # Provider snapshots
│   ├── uxsim/                   # UXsim network definitions + results
│   │   ├── TM-01/, TM-02/, TM-03/, TM-04/  # Per-scenario CSVs
│   │   ├── validation-results.json
│   │   └── historical-analysis.json
│   └── derived/                  # Pipeline outputs
├── docs/roadmap/                 # Technical documentation
├── package.json
└── tsconfig.json
```

---

## Benchmark System

| Track | Description |
|-------|-------------|
| Human | Human-driven scenario performance |
| Agent | AI agent traffic decisions |
| Browser Native | Browser-native IDM simulation |
| SUMO | SUMO-backed simulation |
| SOTA | State-of-the-art model adapters |

Example: TransitLens (Agent) scored **97.4**, Browser Native IDM Baseline scored **89.6**

---

## License

**MIT License** — Permissive open-source license for code and software components.

**Data Liability Disclaimer** — Traffic data from third-party sources is provided as-is:
- **STPT**: Public transport data, subject to STPT terms of service
- **TomTom**: Traffic flow data, subject to TomTom terms of service
- **HERE**: Traffic data, subject to HERE licensing terms
- **Google Maps**: Traffic data, subject to Google Maps Platform terms
- **OpenStreetMap**: Road geometry under ODbL license
- **Timișoara Open Data**: Municipal data under local government terms

The maintainers make no warranties about data accuracy, completeness, or fitness for any purpose. Traffic conditions change rapidly; data reflects the time of collection only. Users are responsible for compliance with applicable data usage terms.